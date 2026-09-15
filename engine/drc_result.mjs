// Only interpret the verbose result of a freshly awaited sch_Drc.check.
// Some clients omit informational findings even in verbose mode. Their absence
// (including an empty result) cannot prove the complete zero-info delivery gate.
export function evaluateDrcResult(raw) {
  const counts = { error: 0, warning: 0, info: null };
  const unknown = [];
  const types = { fatalError: 'error', error: 'error', warn: 'warning', warning: 'warning', info: 'info' };
  if (!Array.isArray(raw)) return { verified: false, pass: false, counts: null, unknown: [raw] };
  for (const row of raw) {
    const kind = row && Object.hasOwn(types, row.type) ? types[row.type] : null;
    if (!kind || !Number.isSafeInteger(row.count) || row.count < 0) {
      unknown.push(row);
      continue;
    }
    counts[kind] = (counts[kind] ?? 0) + row.count;
    if (!Number.isSafeInteger(counts[kind])) unknown.push(row);
  }
  const missingSeverities = counts.info === null ? ['info'] : [];
  const verified = unknown.length === 0 && missingSeverities.length === 0;
  return { verified, pass: verified && Object.values(counts).every(n => n === 0), counts, unknown, missingSeverities };
}

export function parseDrcCompletionText(text) {
  const s=String(text||'');
  const zh=[...s.matchAll(/完成设计规则检查[^\n]*致命错误[：:]\s*(\d+)[，,\s]+错误[：:]\s*(\d+)[，,\s]+警告[：:]\s*(\d+)[，,\s]+信息[：:]\s*(\d+)/g)].at(-1);
  if(zh)return{fatal:Number(zh[1]),error:Number(zh[2]),warning:Number(zh[3]),info:Number(zh[4]),line:zh[0]};
  const en=[...s.matchAll(/(?:DRC|design rule check)[^\n]*fatal(?: errors?)?[：:]\s*(\d+)[,\s]+errors?[：:]\s*(\d+)[,\s]+warnings?[：:]\s*(\d+)[,\s]+(?:info|information)[：:]\s*(\d+)/gi)].at(-1);
  return en?{fatal:Number(en[1]),error:Number(en[2]),warning:Number(en[3]),info:Number(en[4]),line:en[0]}:null;
}

// Turn EasyEDA's native DRC log into addressable findings.  The aggregate API
// result is authoritative for counts, while these rows supply the objects that
// an automated repair needs.  Keep the original message so localized or newer
// EasyEDA builds never lose information when a pattern is not recognized yet.
export function parseDrcDiagnosticRows(text) {
  const rows = [];
  const re = /\[(致命错误|错误|警告|信息|fatal error|error|warning|info)\]\s*:\s*([^\n]+)/gi;
  const severity = {
    '致命错误': 'fatal', '错误': 'error', '警告': 'warning', '信息': 'info',
    'fatal error': 'fatal', error: 'error', warning: 'warning', info: 'info',
  };
  for (const match of String(text || '').matchAll(re)) {
    const message = match[2].trim();
    if (/^(?:开始|完成)设计规则检查|^(?:start|complete).*design rule check/i.test(message)) continue;
    const designatorPins = [...message.matchAll(/\b([A-Z][A-Z0-9_-]*\d+)\.([A-Z0-9#_-]+)\b/g)]
      .map(m => ({ designator: m[1], pin: m[2] }));
    const boundParts = [...message.matchAll(/\b([A-Z][A-Z0-9_-]*\d+)\(\$[^)]+\)/g)]
      .map(m => m[1]);
    const internalIds = [...message.matchAll(/\$\d+I\d+/g)].map(m => m[0]);
    const componentName = message.match(/元件\s+([^\s]+)\s+的引脚与焊盘|component\s+([^\s]+).*pin.*pad/i);
    rows.push({
      severity: severity[match[1].toLowerCase()] || severity[match[1]],
      message,
      designatorPins,
      designators: [...new Set([...designatorPins.map(x => x.designator), ...boundParts])],
      internalIds: [...new Set(internalIds)],
      componentName: componentName ? (componentName[1] || componentName[2]) : null,
    });
  }
  return rows;
}

export function attributeDrcRows(rows, { designators = [], componentNames = [] } = {}) {
  const currentDesignators = new Set(designators.filter(Boolean));
  const currentNames = new Set(componentNames.filter(Boolean));
  return (rows || []).map(row => {
    const refs = row.designators || [];
    const currentRefs = refs.filter(x => currentDesignators.has(x));
    const otherRefs = refs.filter(x => !currentDesignators.has(x));
    const currentDesignatorPins = (row.designatorPins || []).filter(x => currentDesignators.has(x.designator));
    const otherDesignatorPins = (row.designatorPins || []).filter(x => !currentDesignators.has(x.designator));
    let scope = 'unknown';
    if (currentRefs.length && !otherRefs.length) scope = 'current-page';
    else if (otherRefs.length && !currentRefs.length) scope = 'other-page';
    else if (currentRefs.length && otherRefs.length) scope = 'mixed-pages';
    else if (row.componentName && currentNames.has(row.componentName)) scope = 'current-page';
    else if (row.componentName) scope = 'other-page';
    return { ...row, scope, currentRefs, otherRefs, currentDesignatorPins, otherDesignatorPins };
  });
}

export function currentPageDrcMagnitude(rows) {
  return (rows || []).reduce((sum, row) => {
    if (row.scope !== 'current-page' && row.scope !== 'mixed-pages') return sum;
    if (row.currentDesignatorPins?.length) return sum + row.currentDesignatorPins.length;
    if (row.currentRefs?.length) return sum + row.currentRefs.length;
    return sum + 1;
  }, 0);
}

// EasyEDA returns project-wide DRC totals even when the agent is repairing one
// page.  A copied backup page must remain visible in the raw evidence, but it
// must not make the active page look electrically dirty.  Scope the totals only
// when every non-zero native row is represented exactly once by a parsed,
// page-attributed diagnostic.  Any missing or ambiguous row fails closed by
// leaving the project-wide totals in force.
export function deriveCurrentPageDrc(evidence, rows) {
  const raw = evidence?.counts;
  if (evidence?.verified !== true || !raw || !Array.isArray(rows)) {
    return { verified: false, counts: null, reason: 'unverified-native-evidence' };
  }
  const normalizeSeverity = value => value === 'fatal' ? 'error' : value;
  const represented = { error: 0, warning: 0, info: 0 };
  const current = { error: 0, warning: 0, info: 0 };
  for (const row of rows) {
    const severity = normalizeSeverity(row?.severity);
    if (!Object.hasOwn(represented, severity)) continue;
    represented[severity] += 1;
    if (row.scope === 'current-page' || row.scope === 'mixed-pages') current[severity] += 1;
  }
  const complete = ['error', 'warning', 'info'].every(key => represented[key] === raw[key]);
  const attributed = rows.every(row => row.scope === 'current-page' || row.scope === 'other-page' || row.scope === 'mixed-pages');
  if (!complete || !attributed) {
    return { verified: false, counts: null, represented, raw: { ...raw }, reason: !complete ? 'diagnostic-count-mismatch' : 'unattributed-diagnostic' };
  }
  return { verified: true, counts: current, represented, raw: { ...raw } };
}

// Older EasyEDA builds return aggregate API rows without an explicit info=0.
// A freshly appended native completion line covers all four severities and is
// authoritative. Stale DOM text never upgrades an incomplete API result.
export function evaluateDrcEvidence(raw, { completion='', fresh=false, invoked=false } = {}) {
  const fromApi=evaluateDrcResult(raw);
	const parsed=(fresh||invoked)?parseDrcCompletionText(completion):null;
  if(!parsed)return{...fromApi,source:'api'};
  const counts={error:parsed.fatal+parsed.error,warning:parsed.warning,info:parsed.info};
	// EasyEDA may reuse the DRC panel DOM when a repeated check finds the same
	// violations.  Accept that post-call completion row only when the severities
	// returned by the freshly awaited verbose API agree with it.  This recovers
	// the information count omitted by some clients without trusting stale UI.
	if(invoked&&Array.isArray(raw)){
		const apiError=raw.filter(row=>row?.type==='error'||row?.type==='fatalError').reduce((n,row)=>n+(Number.isSafeInteger(row.count)?row.count:0),0);
		const apiWarning=raw.filter(row=>row?.type==='warn'||row?.type==='warning').reduce((n,row)=>n+(Number.isSafeInteger(row.count)?row.count:0),0);
		if(apiError!==counts.error||apiWarning!==counts.warning)return{...fromApi,source:'api-ui-mismatch'};
	}
  return{verified:true,pass:Object.values(counts).every(n=>n===0),counts,unknown:[],missingSeverities:[],source:'native-completion',fatal:parsed.fatal,ordinaryError:parsed.error,line:parsed.line};
}

export function evaluateSourceAudit(sourceReport, rawDrc, completionEvidence) {
  const drc = evaluateDrcEvidence(rawDrc, completionEvidence);
  const sourcePass = Array.isArray(sourceReport?.findings) && sourceReport.findings.length === 0;
  // Geometry, connectivity, boundaries and visual evidence are separate gates.
  return { pass: sourcePass && drc.pass, sourcePass, drc, deliveryVerified: false };
}

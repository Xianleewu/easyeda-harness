import { isDeepStrictEqual } from 'node:util';

// getDocumentSource regenerates these three DOCHEAD fields on every read.
// Keep all circuit bytes and document identity in the optimistic write guard.
// This function is also serialized into the EDA runtime; keep it self-contained.
export function stableSourceContent(source) {
  return source.split('\n').map(line => {
    const separator=line.indexOf('||');
    if(separator<0)return line;
    const head=JSON.parse(line.slice(0,separator));
    if(head.type!=='DOCHEAD')return line;
    const atom=JSON.parse(line.slice(separator+2).replace(/\|$/,''));
    delete atom.client;delete atom.updateTime;delete atom.version;
    return JSON.stringify(head)+'||'+JSON.stringify(atom);
  }).join('\n');
}

function persistedRecord(r) {
  const atom={...r.atom};
  if(r.head.type==='DOCHEAD'){delete atom.client;delete atom.updateTime;delete atom.version;}
  if(r.head.type==='ATTR'){
    // The importer populates these empty library/cache fields and renumbers
    // attribute draw order. Nonempty bindings and visibility remain significant.
    if(atom.key==='Relevance'&&atom.value==='[]')return null;
    // EasyEDA regenerates an empty NET placeholder on unnamed direct wires.
    // Its position/visibility/zIndex are importer-owned and it renders no text,
    // so it is not meaningful persistence evidence.
    if(atom.key==='NET'&&String(atom.value??'').trim()==='')return null;
    if(['Description','3D Model','3D Model Title','3D Model Transform'].includes(atom.key)
      &&(atom.value==null||atom.value==='')&&atom.valueVisible!==true&&atom.keyVisible!==true)return null;
    delete atom.zIndex;
    // Hidden bindings cannot render. EasyEDA may materialize their null style
    // defaults as 0/false during import, so persistence compares the binding
    // value and ignores only these importer-owned display fields.
    if(atom.valueVisible!==true&&atom.keyVisible!==true){
      for(const key of ['x','y','rotation','color','fontFamily','fontSize','fontWeight','italic','underline','strikeout','align','fillColor','locked'])delete atom[key];
      delete atom.valueVisible; delete atom.keyVisible;
    }
    if(atom.strikeout===false)delete atom.strikeout;
    for(const key of Object.keys(atom))if(atom[key]===null)delete atom[key];
    // Pin-number annotation placement is derived from the placed symbol. Its
    // number/value stays checked; live geometry checks its rendered placement.
    if(atom.key==='Pin Number'){delete atom.x;delete atom.y;}
  }
  for(const key of ['x','y','startX','startY','endX','endY'])
    if(typeof atom[key]==='number')atom[key]=Math.round(atom[key]*1e6)/1e6;
  return {type:r.head.type,atom};
}

// Strict record handling for a source transaction. Never silently lose a bad line.
export function readRecords(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Empty document source');
  const records = [], ids = new Set();
  for (const raw of source.split('\n')) {
    if (!raw.trim()) continue;
    const separator = raw.indexOf('||');
    if (separator < 0) throw new Error('Malformed source record');
    const head = JSON.parse(raw.slice(0, separator));
    const atom = JSON.parse(raw.slice(separator + 2).replace(/\|$/, ''));
    if (!head || typeof head.type !== 'string' || !atom || typeof atom !== 'object' || Array.isArray(atom))
      throw new Error('Invalid source record');
    if (head.id != null) {
      if (typeof head.id !== 'string' || !head.id || ids.has(head.id)) throw new Error('Duplicate or invalid record ID');
      ids.add(head.id);
    }
    records.push({ head, atom, raw });
  }
  return records;
}

export function checkSourceIdentity(source, uuid) {
  const headers = readRecords(source).filter(r => r.head.type === 'DOCHEAD');
  if (!uuid || headers.length !== 1 || headers[0].atom.docType !== 'SCH_PAGE' || headers[0].atom.uuid !== uuid)
    throw new Error('Schematic source identity mismatch');
}

export function compileSourcePlan(source, plan, { pinOwners = {}, strictPrimitiveIds = false, componentTypes = {}, allowSheetEdit = false } = {}) {
  const records = readRecords(source);
  const byId = new Map(records.filter(r => r.head.id).map(r => [r.head.id, r]));
  const drop = plan?.drop ?? new Set(), edit = plan?.edit ?? new Map(), add = plan?.add ?? [];
  const candidatePinOwners = { ...pinOwners, ...(plan?.pinOwners ?? {}) };
  if (!(drop instanceof Set) || !(edit instanceof Map) || !Array.isArray(add)) throw new Error('Invalid source plan');
  for (const id of [...drop, ...edit.keys()]) {
    if (!byId.has(id)) throw new Error(`Unknown target: ${id}`);
    if (['DOCHEAD', 'CANVAS'].includes(byId.get(id).head.type)) throw new Error('Document metadata cannot be a transform target');
    if (componentTypes[id] === 'sheet' && !allowSheetEdit)
      throw new Error(`Sheet/title-block component is write-protected: ${id}`);
  }
  // Remove descendants as well: both component attributes and wire lines/labels.
  const removed = new Set(drop);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of records) if ((removed.has(r.atom.parentId) || removed.has(r.atom.lineGroup) || removed.has(candidatePinOwners[r.atom.parentId])) && r.head.id && !removed.has(r.head.id)) {
      removed.add(r.head.id); changed = true;
    }
  }
  for (const id of edit.keys()) if (removed.has(id)) throw new Error(`Edit targets a removed record: ${id}`);
  const output = records.filter(r => !removed.has(r.head.id)).map(r => ({
    head: r.head, atom: edit.has(r.head.id) ? edit.get(r.head.id) : r.atom,
  }));
  const occupied = new Set(byId.keys());
  const attributeKeys = new Set(output.filter(r => r.head.type === 'ATTR')
    .map(r => JSON.stringify([r.atom.parentId, r.atom.key])));
  for (const r of add) {
    if (!r?.head?.id || occupied.has(r.head.id) || ['DOCHEAD', 'CANVAS'].includes(r.head.type))
      throw new Error('Added record must have a new primitive ID');
    if (strictPrimitiveIds && !/^[0-9a-f]{16}$/i.test(r.head.id))
      throw new Error(`Added primitive ID is not a 16-digit hexadecimal EasyEDA ID: ${r.head.id}`);
    occupied.add(r.head.id);
    if (r.head.type === 'ATTR') {
      const key = JSON.stringify([r.atom.parentId, r.atom.key]);
      if (attributeKeys.has(key)) throw new Error('Duplicate attribute: edit the existing parent/key override');
      attributeKeys.add(key);
    }
    output.push({ head: r.head, atom: r.atom });
  }
  const candidate = output.map(r => JSON.stringify(r.head) + '||' + JSON.stringify(r.atom)).join('|\n');
  const verified = readRecords(candidate);
  const liveIds = new Set(verified.map(r => r.head.id).filter(Boolean));
  // Symbol pins are virtual parents, not standalone page records. Their ownership
  // must come from the actual symbol/primitive, never an ID-prefix guess.
  for (const r of verified) {
    if (r.atom.parentId && !liveIds.has(r.atom.parentId) && !liveIds.has(candidatePinOwners[r.atom.parentId]))
      throw new Error(`Orphan child: ${r.head.id}`);
    if (r.atom.lineGroup && !liveIds.has(r.atom.lineGroup)) throw new Error(`Orphan wire segment: ${r.head.id}`);
  }
  return { source: candidate, removed: [...removed], edited: [...edit.keys()], added: add.map(r => r.head.id) };
}

// Verify values and hidden bindings, not merely that requested deletions stuck.
// Only document revision fields and record ticket/order are allowed to change.
export function verifyPersistedSource(expectedSource, actualSource, uuid) {
  checkSourceIdentity(expectedSource, uuid);
  checkSourceIdentity(actualSource, uuid);
  const normalize = records => new Map(records.flatMap(r => {
    const key = r.head.id || r.head.type;
    const record=persistedRecord(r);
    return record?[[key,record]]:[];
  }));
  const expected = normalize(readRecords(expectedSource)), actual = normalize(readRecords(actualSource));
  const findings = [];
  for (const [id, record] of expected) {
    if (!actual.has(id)) findings.push({ id, kind: 'missing' });
    else if (!isDeepStrictEqual(record, actual.get(id))) findings.push({ id, kind: 'changed' });
  }
  for (const id of actual.keys()) if (!expected.has(id)) findings.push({ id, kind: 'unexpected' });
  return { pass: findings.length === 0, findings };
}

export function planRollbackResidueCleanup(expectedSource, actualSource, uuid) {
  const verification=verifyPersistedSource(expectedSource,actualSource,uuid);
  if(verification.pass)return {pass:true,drop:new Set(),findings:[]};
  const actualById=new Map(readRecords(actualSource).filter(r=>r.head.id).map(r=>[r.head.id,r]));
  const expectedIds=new Set(readRecords(expectedSource).map(r=>r.head.id).filter(Boolean));
  const allowedKeys=new Set(['3D Model','3D Model Title','3D Model Transform']);
  const cleanup=[];
  for(const finding of verification.findings){
    const record=actualById.get(finding.id);
    const safe=finding.kind==='unexpected'&&record?.head.type==='ATTR'&&allowedKeys.has(record.atom.key)&&
      record.atom.valueVisible!==true&&record.atom.keyVisible!==true&&expectedIds.has(record.atom.parentId);
    if(!safe)return {pass:false,drop:new Set(),findings:verification.findings};
    cleanup.push(finding.id);
  }
  return {pass:true,drop:new Set(cleanup),findings:verification.findings};
}

// For explicitly authorized incremental repairs: all records outside one declared
// module remain identical. This reports a stage, never whole-sheet acceptance.
export function auditRepairScope(beforeSource, candidateSource, roots, pinOwners = {}) {
  if (!Array.isArray(roots) || !roots.length || new Set(roots).size !== roots.length)
    throw new Error('Repair stage needs explicit, unique module roots');
  const selected = new Set(roots);
  const split = source => {
    const records = readRecords(source), byId = new Map(records.map(r => [r.head.id,r]));
    const rootOf = (r, seen = new Set()) => {
      if (seen.has(r.head.id)) throw new Error('Cyclic source parent');
      seen.add(r.head.id);
      const parent = r.atom.parentId || r.atom.lineGroup;
      const owner = parent && (byId.get(parent) || byId.get(pinOwners[parent]));
      return owner ? rootOf(owner,seen) : r.head.id;
    };
    const inside = [], outside = new Map();
    for (const r of records) {
      if (selected.has(rootOf(r))) inside.push(r);
      else {const record=persistedRecord(r);if(record)outside.set(r.head.id||r.head.type,record);}
    }
    return {inside,outside};
  };
  const before=split(beforeSource), after=split(candidateSource);
  if (!isDeepStrictEqual(before.outside,after.outside)) throw new Error('Repair changed records outside its module');
  const scopedSource=after.inside.map(r=>JSON.stringify(r.head)+'||'+JSON.stringify(r.atom)).join('|\n');
  return {outsideUnchanged:true,scopedSource,records:after.inside.length,deliveryVerified:false};
}

import { readFileSync } from 'node:fs';
import { readRecords } from './source_transaction.mjs';
import { enrichNetLabels, assertNetLabelCoverage } from './source_labels.mjs';
import { buildRegionEvidence } from './region_evidence.mjs';
import { judgeBoardTokens, applyLiveFootprintEvidence } from './commercial_judge.mjs';
import { evaluateDeliveryGate } from './delivery_gate.mjs';
import { predictSourceCandidate } from './source_candidate_twin.mjs';
import { auditSourceCatalogBindings } from './source_catalog_audit.mjs';

export function netsFromEasyEdaNetlist(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Authoritative netlist is missing');
  const nets = {};
  for (const component of Object.values(raw.components || {})) {
    const ref = component?.props?.Designator;
    if (!ref) continue;
    nets[ref] = {};
    for (const [pin, info] of Object.entries(component.pinInfoMap || {})) nets[ref][pin] = info?.net ?? '';
  }
  if (!Object.keys(nets).length) throw new Error('Authoritative netlist has no component pin map');
  return nets;
}

function sourceCoverage(source, model, componentTypes = {}) {
  const records = readRecords(source);
  const attrs = new Map();
  for (const r of records) if (r.head.type === 'ATTR' && r.atom.parentId) {
    if (!attrs.has(r.atom.parentId)) attrs.set(r.atom.parentId, []);
    attrs.get(r.atom.parentId).push(r.atom);
  }
  const expectedParts = [], expectedFlags = [], unknownComponents = [];
  for (const r of records.filter(r => r.head.type === 'COMPONENT')) {
    if (componentTypes[r.head.id] === 'sheet') continue;
    const own = attrs.get(r.head.id) || [];
    const designator = own.find(a => a.key === 'Designator')?.value;
    const globalNet = own.find(a => a.key === 'Global Net Name')?.value;
    if (designator) expectedParts.push({ id:r.head.id, designator:String(designator) });
    else if (globalNet) expectedFlags.push({ id:r.head.id, net:String(globalNet) });
    else unknownComponents.push(r.head.id);
  }
  const actualParts = new Map((model.components || []).map(c => [c.id, c]));
  const actualFlags = new Map((model.netflags || []).filter(f => f.id && f.kind !== 'sig').map(f => [f.id, f]));
  const findings = [];
  for (const p of expectedParts) {
    const actual = actualParts.get(p.id);
    if (!actual) findings.push({kind:'candidate-part-missing',...p});
    else if (actual.designator !== p.designator) findings.push({kind:'candidate-designator-mismatch',...p,actual:actual.designator});
  }
  for (const f of expectedFlags) {
    const actual = actualFlags.get(f.id);
    if (!actual) findings.push({kind:'candidate-netflag-missing',...f});
    else if (actual.net !== f.net) findings.push({kind:'candidate-netflag-name-mismatch',...f,actual:actual.net});
  }
  for (const id of actualParts.keys()) if (!expectedParts.some(p => p.id === id)) findings.push({kind:'candidate-part-unexpected',id});
  for (const id of actualFlags.keys()) if (!expectedFlags.some(f => f.id === id)) findings.push({kind:'candidate-netflag-unexpected',id});
  const expectedSegments = records.filter(r => r.head.type === 'LINE' && r.atom.lineGroup &&
    !(r.atom.startX === r.atom.endX && r.atom.startY === r.atom.endY)).length;
  const actualSegments = (model.wires || []).reduce((sum,w) => sum + Math.floor((w.line || []).length / 4), 0);
  if (expectedSegments !== actualSegments) findings.push({kind:'candidate-wire-segment-coverage',expected:expectedSegments,actual:actualSegments});
  for (const id of unknownComponents) findings.push({kind:'candidate-component-type-unknown',id});
  return {pass:findings.length===0,findings,expected:{parts:expectedParts.length,netflags:expectedFlags.length,segments:expectedSegments},
    actual:{parts:actualParts.size,netflags:actualFlags.size,segments:actualSegments}};
}

export function applyVerifiedPinStateChanges(model,candidateSource,changes,{pinOwners={}}={}){
  if(!changes?.length)return model;
  const records=readRecords(candidateSource),states=new Map();
  for(const r of records)if(r.head.type==='ATTR'&&r.atom.key==='NO_CONNECT'&&r.atom.parentId){
    if(states.has(r.atom.parentId))throw new Error(`Duplicate NO_CONNECT state for ${r.atom.parentId}`);
    states.set(r.atom.parentId,String(r.atom.value||'').toLowerCase()==='yes');
  }
  for(const change of changes){
    if(!change?.componentId||!change.ref||change.pin==null||!change.parentId||typeof change.noConnected!=='boolean')
      throw new Error('Invalid candidate pin-state change');
    if(pinOwners[change.parentId]!==change.componentId)throw new Error(`Unverified pin owner for ${change.ref}.${change.pin}`);
    const actual=states.get(change.parentId)===true;
    if(actual!==change.noConnected)throw new Error(`Candidate source pin state mismatch for ${change.ref}.${change.pin}`);
    const component=(model.components||[]).find(c=>c.id===change.componentId&&c.designator===change.ref);
    const pin=component?.pins?.find(p=>String(p.num)===String(change.pin));
    if(!pin)throw new Error(`Candidate model pin is missing: ${change.ref}.${change.pin}`);
    pin.noConnected=change.noConnected;
  }
  return model;
}

export function applyVerifiedPinNetChanges(baselineNets,changes){
  const expected=structuredClone(baselineNets||{});
  for(const change of changes||[]){
    if(!change?.ref||change.pin==null||typeof change.before!=='string'||typeof change.after!=='string')
      throw new Error('Invalid candidate pin-net change');
    const pin=String(change.pin),actual=String(expected?.[change.ref]?.[pin]??'');
    if(actual!==change.before)throw new Error(`Candidate pin-net baseline mismatch for ${change.ref}.${pin}: ${actual} != ${change.before}`);
    if(!expected[change.ref])throw new Error(`Candidate pin-net component is missing: ${change.ref}`);
    expected[change.ref][pin]=change.after;
  }
  return expected;
}

export function applyBaselineLiveEvidence(tokenEvidence, baselineReport) {
	if (!tokenEvidence) return tokenEvidence;
	return {
		...tokenEvidence,
		...(Array.isArray(tokenEvidence.connectorFootprintProfiles) ? { connectorFootprintProfiles:applyLiveFootprintEvidence(
			tokenEvidence.connectorFootprintProfiles, baselineReport?.footprintEvidence || []) } : {}),
		passiveFootprintSources: (()=>{
			const baseline=baselineReport?.footprintEvidence||[],known=new Set(baseline.map(x=>String(x?.footprintUuid||'')));
			return [...baseline,...(tokenEvidence.passiveFootprintSources||[]).filter(x=>!known.has(String(x?.footprintUuid||'')))];
		})(),
	};
}

export async function runCandidatePreflight({ candidateSource, baselineSource, plan, baselineReport, tokenEvidence, componentTypes = {}, pinOwners = {} }) {
  if (!baselineReport?.geometryArtifact || !baselineReport?.netlistArtifact)
    throw new Error('Baseline live evidence is incomplete; candidate preflight cannot run');
  const baselineGeometry = JSON.parse(readFileSync(baselineReport.geometryArtifact, 'utf8').replace(/^\uFEFF/, ''));
  const authoritativeNetlist = JSON.parse(readFileSync(baselineReport.netlistArtifact, 'utf8').replace(/^\uFEFF/, ''));
  const baselineNets=netsFromEasyEdaNetlist(authoritativeNetlist);
  const candidateExpectedNets=applyVerifiedPinNetChanges(baselineNets,plan?.pinNetChanges);
  const prediction = typeof plan?.predictCandidate === 'function'
    ? await plan.predictCandidate(candidateSource,{baselineSource,baselineGeometry,authoritativeNetlist,baselineNets,candidateExpectedNets})
    : predictSourceCandidate(candidateSource,{baselineSource,baselineGeometry,baselineNets:candidateExpectedNets,componentTypes});
  if (!prediction?.model || !prediction?.nets) throw new Error('Candidate predictor must return complete {model,nets} evidence');
  applyVerifiedPinStateChanges(prediction.model,candidateSource,plan?.pinStateChanges,{pinOwners});
  const catalogBindings=auditSourceCatalogBindings(baselineSource,candidateSource,{bindingRepairs:plan?.catalogBindingRepairs});
  if(!catalogBindings.pass)throw new Error(`Candidate catalog binding audit failed: ${JSON.stringify(catalogBindings.findings)}`);
  // A predictor is allowed to start from a previously enriched live snapshot.
  // Rebuild source-owned signal labels exactly once from the candidate source.
  const baseModel = {...prediction.model,
    netflags:(prediction.model.netflags||[]).filter(f=>f.kind!=='sig'),
    _labelCount:undefined,_labelCoverage:undefined};
  const model = enrichNetLabels(baseModel, candidateSource);
  model._labelCoverage = assertNetLabelCoverage(model, candidateSource);
  const coverage = sourceCoverage(candidateSource, model, {...componentTypes,...(plan.componentTypes||{})});
  if (!coverage.pass) throw new Error(`Candidate geometry coverage failed: ${JSON.stringify(coverage.findings)}`);
  const effectiveTokenEvidence=applyBaselineLiveEvidence(tokenEvidence,baselineReport);
  const materialize = regions => buildRegionEvidence(model, regions, {padding:10,requireComplete:true});
  const moduleRegions = materialize(effectiveTokenEvidence.moduleRegions);
  const cellRegions = materialize(effectiveTokenEvidence.cellRegions);
  const baselineDrc = baselineReport.drc;
  if (baselineReport.tier1?.conform !== true || baselineDrc?.evidence?.verified !== true)
    throw new Error('Baseline native DRC is not verified clean for offline carry-forward');
	const report = judgeBoardTokens(model, { ...effectiveTokenEvidence, nets:prediction.nets, drc:baselineDrc,
		moduleRegions,cellRegions,requirePageEvidence:true,requireConnectorSemanticEvidence:true,requireLiveFootprintEvidence:true,requireHighSpeedEvidence:true,requirePassiveEvidence:true });
  const predicted = {...report,drc:baselineDrc,shots:[],regionEvidence:{moduleRegions,cellRegions},
    predictionEvidence:prediction.evidence||null,sourceCoverage:coverage,catalogBindings,nativeDrcStatus:'pending-post-write-verification'};
  const gate = evaluateDeliveryGate(predicted,{before:baselineReport,repair:true});
  return {...predicted,prewriteGate:gate,pass:gate.pass};
}

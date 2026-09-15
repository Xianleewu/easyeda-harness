import {readRecords} from './source_transaction.mjs';

const BINDING_KEYS=Object.freeze(['Symbol','Device','Footprint','Supplier','Supplier Part','Manufacturer','Manufacturer Part',
  'LCSC Part Name','Supplier Footprint','JLCPCB Part Class','Datasheet','Value','Name','Tolerance','Voltage Rating',
  'Temperature Coefficient','Add into BOM','Convert to PCB']);

function parts(source){
  if(typeof source!=='string'||!source.trim())return[];
  const records=readRecords(source),attrs=new Map();
  for(const r of records)if(r.head.type==='ATTR'&&r.atom.parentId){if(!attrs.has(r.atom.parentId))attrs.set(r.atom.parentId,new Map());attrs.get(r.atom.parentId).set(r.atom.key,r.atom.value??null);}
  return records.filter(r=>r.head.type==='COMPONENT'&&attrs.get(r.head.id)?.get('Designator')).map(r=>({id:r.head.id,partId:r.atom.partId||'',
    designator:String(attrs.get(r.head.id).get('Designator')),attrs:attrs.get(r.head.id)}));
}

function sameBinding(a,b){return a.partId===b.partId&&BINDING_KEYS.every(k=>(a.attrs.get(k)??null)===(b.attrs.get(k)??null));}

function repairFor(table,designator){
  if(table instanceof Map)return table.get(designator);
  return table?.[designator];
}

function verifiedRepair(changes,repair){
  if(!repair||repair.verified!==true||!String(repair.source||'').trim()||!repair.changes||typeof repair.changes!=='object')return false;
  const declared=Object.entries(repair.changes);
  if(declared.length!==changes.length)return false;
  return changes.every(change=>{
    const expected=repair.changes[change.key];
    return expected&&Object.hasOwn(expected,'before')&&Object.hasOwn(expected,'current')&&
      (expected.before??null)===(change.before??null)&&(expected.current??null)===(change.current??null);
  });
}

export function auditSourceCatalogBindings(beforeSource,candidateSource,{bindingRepairs={}}={}){
  const before=parts(beforeSource),candidate=parts(candidateSource),priorById=new Map(before.map(p=>[p.id,p]));
  const findings=[],rows=[];
  for(const placed of candidate){
    const prior=priorById.get(placed.id);
    if(prior){
      const changes=[];
      if(prior.partId!==placed.partId)changes.push({key:'partId',before:prior.partId,current:placed.partId});
      for(const key of BINDING_KEYS)if((prior.attrs.get(key)??null)!==(placed.attrs.get(key)??null))changes.push({key,before:prior.attrs.get(key)??null,current:placed.attrs.get(key)??null});
      const repair=repairFor(bindingRepairs,placed.designator),repaired=changes.length>0&&verifiedRepair(changes,repair);
      if(changes.length&&!repaired)findings.push({kind:'existing-catalog-binding-changed',designator:placed.designator,id:placed.id,changes});
      rows.push({designator:placed.designator,id:placed.id,disposition:repaired?'verified-binding-repair':'existing',conform:changes.length===0||repaired,repair:repaired?repair:null});
      continue;
    }
    const donors=before.filter(p=>sameBinding(p,placed));
    if(!donors.length)findings.push({kind:'added-catalog-clone-unproven',designator:placed.designator,id:placed.id,donors:[]});
    rows.push({designator:placed.designator,id:placed.id,disposition:'added-clone',donor:donors[0]?.designator||null,conform:donors.length>0});
  }
  const candidateIds=new Set(candidate.map(p=>p.id));
  for(const prior of before)if(!candidateIds.has(prior.id))findings.push({kind:'catalog-part-removed',designator:prior.designator,id:prior.id});
  return{pass:findings.length===0,findings,rows,detail:{before:before.length,candidate:candidate.length,added:rows.filter(r=>r.disposition==='added-clone').length}};
}

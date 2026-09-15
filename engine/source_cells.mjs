// Generic source-level construction cells. They compile a high-level intent
// into EasyEDA records while preserving catalog identity from a verified donor.

function orthogonal([x1,y1,x2,y2]){return x1===x2||y1===y2;}

export function addClonedTwoTerminalShunt(records,spec){
  const {templateId,groundFlagTemplateId,supplyWireId,ref,center,rotation=270,
    annotation,groundFlag,supplySegments,groundSegments,idPrefix='ad'}=spec||{};
  if(!templateId||!groundFlagTemplateId||!supplyWireId||!ref||![center?.x,center?.y,groundFlag?.x,groundFlag?.y].every(Number.isFinite))
    throw Error('Two-terminal shunt cell needs verified donors, wire, reference and placements');
  if(!/^[0-9a-f]{2}$/i.test(idPrefix))throw Error('Two-terminal shunt idPrefix must be two hexadecimal digits');
  if(!Array.isArray(supplySegments)||!supplySegments.length||!Array.isArray(groundSegments)||!groundSegments.length||
    [...supplySegments,...groundSegments].some(s=>!Array.isArray(s)||s.length!==4||!s.every(Number.isFinite)||!orthogonal(s)))
    throw Error('Two-terminal shunt paths must be nonempty orthogonal segments');
  const byId=new Map(records.filter(r=>r.head.id).map(r=>[r.head.id,r])),attrs=new Map(),lines=new Map();
  for(const r of records){
    if(r.head.type==='ATTR'){if(!attrs.has(r.atom.parentId))attrs.set(r.atom.parentId,[]);attrs.get(r.atom.parentId).push(r);}
    if(r.head.type==='LINE'){if(!lines.has(r.atom.lineGroup))lines.set(r.atom.lineGroup,[]);lines.get(r.atom.lineGroup).push(r);}
  }
  const template=byId.get(templateId),flagTemplate=byId.get(groundFlagTemplateId),wire=byId.get(supplyWireId);
  if(template?.head.type!=='COMPONENT'||flagTemplate?.head.type!=='COMPONENT'||wire?.head.type!=='WIRE')throw Error('Two-terminal shunt donor identity mismatch');
  const templateAttrs=attrs.get(templateId)||[],flagAttrs=attrs.get(groundFlagTemplateId)||[];
  if(!templateAttrs.some(a=>a.atom.key==='Designator')||!templateAttrs.some(a=>a.atom.key==='Device')||
    !flagAttrs.some(a=>a.atom.key==='Global Net Name'))throw Error('Two-terminal shunt donors are incomplete');
  const occupied=new Set(records.map(r=>r.head.id).filter(Boolean));let seq=1,ticket=Math.max(0,...records.map(r=>Number(r.head.ticket)||0))+1;
  const nextId=()=>{let id;do{id=`${idPrefix}${(seq++).toString(16).padStart(14,'0')}`;}while(occupied.has(id));occupied.add(id);return id;};
  const fresh=(type,atom)=>({head:{type,ticket:ticket++,id:nextId()},atom});
  const add=[];
  const componentId=nextId(),dx=center.x-template.atom.x,dy=-center.y-template.atom.y;
  add.push({head:{type:'COMPONENT',ticket:ticket++,id:componentId},atom:{...template.atom,x:center.x,y:-center.y,rotation,isMirror:false}});
  for(const item of templateAttrs){
    const atom={...item.atom,parentId:componentId};
    if(Number.isFinite(atom.x))atom.x+=dx;if(Number.isFinite(atom.y))atom.y+=dy;
    if(atom.key==='Designator')Object.assign(atom,{value:ref,x:annotation.designator.x,y:-annotation.designator.y,rotation:0,align:'LEFT_BOTTOM',keyVisible:false,valueVisible:true});
    else if(atom.key==='Name')Object.assign(atom,{x:annotation.value.x,y:-annotation.value.y,rotation:0,align:'LEFT_BOTTOM',keyVisible:false,valueVisible:true});
    else if(atom.key==='Unique ID')atom.value=`${idPrefix}-${ref}`;
    add.push(fresh('ATTR',atom));
  }
  const lineTemplate=(lines.get(supplyWireId)||[])[0]?.atom;
  if(!lineTemplate)throw Error('Two-terminal shunt supply wire has no source line donor');
  for(const [x1,y1,x2,y2] of supplySegments)add.push(fresh('LINE',{...lineTemplate,startX:x1,startY:-y1,endX:x2,endY:-y2,lineGroup:supplyWireId}));
  const groundWireId=nextId();add.push({head:{type:'WIRE',ticket:ticket++,id:groundWireId},atom:{...wire.atom}});
  for(const [x1,y1,x2,y2] of groundSegments)add.push(fresh('LINE',{...lineTemplate,startX:x1,startY:-y1,endX:x2,endY:-y2,lineGroup:groundWireId}));
  add.push(fresh('ATTR',{x:null,y:null,rotation:null,color:null,fontFamily:null,fontSize:null,fontWeight:null,italic:null,underline:null,
    align:null,value:'[]',keyVisible:null,valueVisible:null,key:'Relevance',fillColor:null,parentId:groundWireId,zIndex:2}));
  const flagId=nextId(),fdx=groundFlag.x-flagTemplate.atom.x,fdy=-groundFlag.y-flagTemplate.atom.y;
  add.push({head:{type:'COMPONENT',ticket:ticket++,id:flagId},atom:{...flagTemplate.atom,x:groundFlag.x,y:-groundFlag.y,rotation:groundFlag.rotation??0,isMirror:false}});
  for(const item of flagAttrs){const atom={...item.atom,parentId:flagId};if(Number.isFinite(atom.x))atom.x+=fdx;if(Number.isFinite(atom.y))atom.y+=fdy;add.push(fresh('ATTR',atom));}
  return{add,componentId,groundWireId,groundFlagId:flagId,componentTypes:{[componentId]:'part',[flagId]:'netflag'},
    roots:[supplyWireId,componentId,groundWireId,flagId]};
}

// Replace visible wire-name labels with verified built-in net-flag symbols.
// Several adjacent endpoints may share one flag by removing every label and
// adding orthogonal join segments under one selected wire root. The caller
// supplies grouping geometry; this primitive enforces source identity,
// endpoint anchoring and collision-safe record construction.
export function replaceWireLabelsWithClonedFlags(records, spec = {}) {
  const { flagTemplateId, labels = [], flags = [], joinSegments = [], mergeWireRoots = [], idPrefix = 'fa' } = spec;
  if (!flagTemplateId || !labels.length || !/^[0-9a-f]{2}$/i.test(idPrefix))
    throw Error('Wire-label replacement needs a verified flag donor, labels and a hexadecimal idPrefix');
  const byId=new Map(records.filter(r=>r.head.id).map(r=>[r.head.id,r])), attrs=new Map(), lines=new Map();
  for(const r of records){
    if(r.head.type==='ATTR'){if(!attrs.has(r.atom.parentId))attrs.set(r.atom.parentId,[]);attrs.get(r.atom.parentId).push(r);}
    if(r.head.type==='LINE'){if(!lines.has(r.atom.lineGroup))lines.set(r.atom.lineGroup,[]);lines.get(r.atom.lineGroup).push(r);}
  }
  const template=byId.get(flagTemplateId),templateAttrs=attrs.get(flagTemplateId)||[];
  if(template?.head.type!=='COMPONENT'||!templateAttrs.some(a=>a.atom.key==='Global Net Name'))
    throw Error('Net-flag donor identity mismatch');
  const drop=new Set(), occupied=new Set(records.map(r=>r.head.id).filter(Boolean));
  let seq=1,ticket=Math.max(0,...records.map(r=>Number(r.head.ticket)||0))+1;
  const nextId=()=>{let id;do{id=`${idPrefix}${(seq++).toString(16).padStart(14,'0')}`;}while(occupied.has(id));occupied.add(id);return id;};
  const add=[],componentTypes={},removedRecordIds=new Set();
  for(const item of labels){
    const wire=byId.get(item.wireRootId), candidates=(attrs.get(item.wireRootId)||[]).filter(a=>a.atom.key==='NET'&&a.atom.valueVisible===true);
    if(wire?.head.type!=='WIRE'||candidates.length!==1||candidates[0].atom.value!==item.net)
      throw Error(`Visible wire label identity mismatch: ${item.wireRootId}`);
    const at=[candidates[0].atom.x,-candidates[0].atom.y];
    if(!item.anchor||at[0]!==item.anchor.x||at[1]!==item.anchor.y)
      throw Error(`Visible wire label anchor mismatch: ${item.wireRootId}`);
    const endpoint=(lines.get(item.wireRootId)||[]).some(r=>
      (r.atom.startX===at[0]&&-r.atom.startY===at[1])||(r.atom.endX===at[0]&&-r.atom.endY===at[1]));
    if(!endpoint)throw Error(`Visible wire label is not on a wire endpoint: ${item.wireRootId}`);
    drop.add(candidates[0].head.id);
  }
  for(const item of flags){
    if(!item.wireRootId||!item.net||![item.x,item.y,item.rotation].every(Number.isFinite)||!byId.has(item.wireRootId))
      throw Error('Invalid cloned net-flag placement');
    const componentId=nextId(),dx=item.x-template.atom.x,dy=-item.y-template.atom.y;
    add.push({head:{type:'COMPONENT',ticket:ticket++,id:componentId},atom:{...template.atom,x:item.x,y:-item.y,rotation:item.rotation,isMirror:false}});
    componentTypes[componentId]='netflag';
    for(const sourceAttr of templateAttrs){
      const atom={...sourceAttr.atom,parentId:componentId};
      if(Number.isFinite(atom.x))atom.x+=dx;if(Number.isFinite(atom.y))atom.y+=dy;
      if(atom.key==='Name'||atom.key==='Global Net Name')atom.value=item.net;
      add.push({head:{type:'ATTR',ticket:ticket++,id:nextId()},atom});
    }
  }
  const lineTemplate=[...lines.values()].flat()[0]?.atom;
  if(joinSegments.length&&!lineTemplate)throw Error('No source line donor available');
  for(const item of joinSegments){
    if(!byId.has(item.wireRootId)||!Array.isArray(item.line)||item.line.length!==4||!item.line.every(Number.isFinite)||!orthogonal(item.line))
      throw Error('Invalid ground-group join segment');
    const [x1,y1,x2,y2]=item.line;
    add.push({head:{type:'LINE',ticket:ticket++,id:nextId()},atom:{...lineTemplate,startX:x1,startY:-y1,endX:x2,endY:-y2,lineGroup:item.wireRootId}});
  }
  for(const group of mergeWireRoots){
    if(!group?.into||!Array.isArray(group.from)||!group.from.length||![group.dx,group.dy].every(Number.isFinite)||byId.get(group.into)?.head.type!=='WIRE')
      throw Error('Invalid wire-root merge');
    for(const from of group.from){
      if(from===group.into||byId.get(from)?.head.type!=='WIRE')throw Error('Wire-root merge donor mismatch');
      for(const sourceLine of lines.get(from)||[])add.push({head:{type:'LINE',ticket:ticket++,id:nextId()},atom:{...sourceLine.atom,
        startX:sourceLine.atom.startX+group.dx,endX:sourceLine.atom.endX+group.dx,
        startY:sourceLine.atom.startY-group.dy,endY:sourceLine.atom.endY-group.dy,lineGroup:group.into}});
      drop.add(from);removedRecordIds.add(from);
      for(const r of records)if(r.atom.parentId===from||r.atom.lineGroup===from)removedRecordIds.add(r.head.id);
    }
  }
  return {drop,add,edit:new Map(),componentTypes,removedRecordIds,roots:[...new Set(labels.map(x=>x.wireRootId))],flagIds:Object.keys(componentTypes)};
}

import { readRecords } from './source_transaction.mjs';
import { localGeom, placeGeom } from './local_geom.mjs';
import { calibrateFont } from './source_labels.mjs';
import { recoverConnectivity } from './connectivity_recover.mjs';

function indexSource(source) {
  const records=readRecords(source),byId=new Map(),attrs=new Map(),lines=new Map();
  for(const r of records){
    if(r.head.id)byId.set(r.head.id,r);
    if(r.head.type==='ATTR'&&r.atom.parentId){if(!attrs.has(r.atom.parentId))attrs.set(r.atom.parentId,[]);attrs.get(r.atom.parentId).push(r);}
    if(r.head.type==='LINE'&&r.atom.lineGroup){if(!lines.has(r.atom.lineGroup))lines.set(r.atom.lineGroup,[]);lines.get(r.atom.lineGroup).push(r);}
  }
  return{records,byId,attrs,lines};
}

const attrValue=(index,id,key)=>index.attrs.get(id)?.find(r=>r.atom.key===key)?.atom.value;
const visible=a=>a?.valueVisible===true||a?.keyVisible===true;
const donorKey=(index,record)=>JSON.stringify([record.atom.partId||'',attrValue(index,record.head.id,'Device')||'',
  attrValue(index,record.head.id,'Symbol')||'',attrValue(index,record.head.id,'Designator')?'part':attrValue(index,record.head.id,'Global Net Name')?'netflag':'unknown']);

function textBox(atom,font,donor){
  if(!visible(atom)||!Number.isFinite(atom.x)||!Number.isFinite(atom.y))return null;
  const x=atom.x,y=-atom.y;
  if(donor?.bbox&&donor.value===atom.value&&donor.x!=null&&donor.y!=null){
    const dx=x-donor.x,dy=y-donor.y;
    return{minX:donor.bbox.minX+dx,minY:donor.bbox.minY+dy,maxX:donor.bbox.maxX+dx,maxY:donor.bbox.maxY+dy};
  }
  const value=atom.valueVisible===true?atom.value:atom.key;
  const w=Math.max(1,String(value??'').length)*font.charW,h=font.charH;
  const [hor='',vert='']=String(atom.align||'').toUpperCase().split('_');
  const minX=(hor==='RIGHT'||hor==='END')?x-w:(hor==='CENTER'||hor==='MIDDLE')?x-w/2:x;
  // Component-child Global Net Name follows the live EasyEDA Cartesian axis:
  // BOTTOM grows toward +Y (visually above), TOP toward -Y (visually below).
  // Wire NET text uses the ordinary text convention handled elsewhere.
  const minY=atom.key==='Global Net Name'
    ? (vert==='TOP'?y-h:vert==='BOTTOM'?y:y-h/2)
    : (vert==='BOTTOM'?y-h:vert==='TOP'?y:y-h/2);
  return{minX,minY,maxX:minX+w,maxY:minY+h};
}

const LIVE_ENRICHED_ATTR_KEYS=new Set(['Footprint']);

function candidateAttrs(index,id,donor,font,baselineIndex){
  const donorByKey=new Map((donor?.attrs||[]).map(a=>[a.key,a]));
  const sourceAttrs=index.attrs.get(id)||[];
  const out=sourceAttrs.map(r=>{
    const a=r.atom,d=donorByKey.get(a.key);
    const x=Number.isFinite(a.x)?a.x:null,y=Number.isFinite(a.y)?-a.y:null;
    return{key:a.key,value:a.value,keyVisible:a.keyVisible,valueVisible:a.valueVisible,x,y,rotation:a.rotation==null?0:Number(a.rotation),bbox:textBox(a,font,d)};
  });
  // EasyEDA omits some resolved library metadata from the document source but
  // returns it in live component geometry. Preserve only an explicit allowlist,
  // and only while the Symbol/Device identity is unchanged. If the attribute
  // existed in the baseline source and the transform removed it, that removal
  // is intentional and must stay removed.
  const beforeAttrs=baselineIndex?.attrs.get(id)||[];
  const sameLibraryIdentity=['Symbol','Device'].every(key=>attrValue(index,id,key)===attrValue(baselineIndex,id,key));
  if(sameLibraryIdentity)for(const key of LIVE_ENRICHED_ATTR_KEYS){
    const sourceAttr=sourceAttrs.find(r=>r.atom.key===key),beforeAttr=beforeAttrs.find(r=>r.atom.key===key);
    const inherited=donorByKey.get(key);
    if(!inherited)continue;
    if(!sourceAttr&&!beforeAttr)out.push(structuredClone(inherited));
    else if(sourceAttr&&beforeAttr&&sourceAttr.atom.value==null&&beforeAttr.atom.value==null){
      const target=out.find(a=>a.key===key);if(target)target.value=inherited.value;
    }
  }
  return out;
}

function transformBox(box,from,to){
  if(!box)return null;const dx=to.x-from.x,dy=to.y-from.y;
  return{minX:box.minX+dx,minY:box.minY+dy,maxX:box.maxX+dx,maxY:box.maxY+dy};
}

function baselineWireNets(model){
  const out=new Map();
  for(const w of model.wires||[]){const root=String(w.id||'').split('#')[0];if(w.net&&!out.has(root))out.set(root,w.net);}
  return out;
}

const ROOT_EPS=1e-6;
function pointOnSegment(x,y,line){
  const [x1,y1,x2,y2]=line;
  if(x<Math.min(x1,x2)-ROOT_EPS||x>Math.max(x1,x2)+ROOT_EPS||y<Math.min(y1,y2)-ROOT_EPS||y>Math.max(y1,y2)+ROOT_EPS)return false;
  return Math.abs((x-x1)*(y2-y1)-(y-y1)*(x2-x1))<=ROOT_EPS;
}

// EasyEDA V3 stores electrical connectivity by WIRE root. Two different roots
// that merely meet on the canvas do not inherit each other's NET/netflag. Keep
// this check source-aware; geometric recovery below cannot prove root naming.
function assertNamedPinsHaveNamedWireRoots({index,rootLines,components,netflags,baselineNets,oldWireNets,baselineRootIds}){
  const roots=[];
  for(const [id,lines] of rootLines){
    const segments=lines.map(r=>[r.atom.startX,-r.atom.startY,r.atom.endX,-r.atom.endY]);
    const names=new Set();
    const explicit=String(attrValue(index,id,'NET')||'').trim();
    if(explicit)names.add(explicit);
    else if(oldWireNets.get(id))names.add(oldWireNets.get(id));
    for(const f of netflags||[])if(segments.some(line=>pointOnSegment(f.x,f.y,line)))names.add(f.net);
    roots.push({id,segments,names:[...names]});
  }
  // A preserved root may be an intentionally unnamed local connection. Its
  // stable source identity plus one unambiguous authoritative baseline net is
  // sufficient evidence. Never apply this inheritance to a newly created root.
  for(const root of roots)if(!root.names.length&&baselineRootIds.has(root.id)){
    const names=new Set();
    for(const c of components||[])for(const p of c.pins||[])if(root.segments.some(line=>pointOnSegment(p.x,p.y,line))){
      const expected=String(baselineNets?.[c.designator]?.[p.num]||'').trim();
      if(expected&&!/^NC(?:$|[_-])/i.test(expected))names.add(expected);
    }
    if(names.size===1)root.names=[...names];
  }
  const findings=[],pinNets={};
  for(const c of components||[])for(const p of c.pins||[]){
    const expected=String(baselineNets?.[c.designator]?.[p.num]||'').trim();
    if(!expected||/^NC(?:$|[_-])/i.test(expected))continue;
    const touching=roots.filter(root=>root.segments.some(line=>pointOnSegment(p.x,p.y,line)));
    const directFlags=(netflags||[]).filter(f=>Math.abs(f.x-p.x)<=ROOT_EPS&&Math.abs(f.y-p.y)<=ROOT_EPS).map(f=>f.net);
    const named=[...new Set([...touching.flatMap(root=>root.names),...directFlags].filter(Boolean))];
    if(named.length===1)(pinNets[c.designator]??={})[p.num]=named[0];
    if(touching.some(root=>root.names.includes(expected))||directFlags.includes(expected))continue;
    // A pin with no source wire may still meet another component pin. A pin
    // attached to a source root must obtain its name from that exact root.
    if(touching.length)findings.push({kind:'candidate-wire-root-net-mismatch',ref:c.designator,pin:p.num,expected,
      roots:touching.map(root=>({id:root.id,names:root.names}))});
  }
  if(findings.length)throw Error(`Source candidate WIRE-root connectivity mismatch: ${JSON.stringify(findings)}`);
  return pinNets;
}

function logicalToPinMap(logical){
  const nets={};
  for(const n of logical.nets||[])for(const refpin of n.pins||[]){
    const dot=refpin.lastIndexOf('.');if(dot<1)continue;const ref=refpin.slice(0,dot),pin=refpin.slice(dot+1);
    (nets[ref]??={})[pin]=n.name;
  }
  return nets;
}

function reconcileNets(model,baselineNets,sourcePinNets={}){
  const recoveredLogical=recoverConnectivity(model,1);
  const componentConflicts=[];
  for(const net of recoveredLogical.nets||[]){
    const authoritative=new Set();
    for(const refpin of net.pins||[]){
      const dot=refpin.lastIndexOf('.');if(dot<1)continue;
      const ref=refpin.slice(0,dot),pin=refpin.slice(dot+1),name=baselineNets?.[ref]?.[pin];
      if(name&&!/^NC(?:$|[_-])/i.test(name))authoritative.add(name);
    }
    if(authoritative.size>1)componentConflicts.push({pins:net.pins,nets:[...authoritative]});
    else if(authoritative.size===1){
      const [name]=authoritative;
      if(net.class!=='local'&&net.name&&net.name!==name)componentConflicts.push({pins:net.pins,nets:[net.name,name]});
      else net.name=name;
    }
  }
  const recovered=logicalToPinMap(recoveredLogical);
  for(const [ref,pins] of Object.entries(sourcePinNets))for(const [pin,net] of Object.entries(pins)){
    const geometric=recovered[ref]?.[pin];
    if(geometric&&geometric!==net)componentConflicts.push({pins:[`${ref}.${pin}`],nets:[geometric,net]});
    else (recovered[ref]??={})[pin]=net;
  }
  const mismatches=componentConflicts.map(x=>({kind:'candidate-short',...x}));
  for(const [ref,pins] of Object.entries(baselineNets||{}))for(const [pin,net] of Object.entries(pins||{})){
    if(!net||/^NC(?:$|[_-])/i.test(net))continue;
    const actual=recovered[ref]?.[pin]||'';
    if(actual!==net)mismatches.push({ref,pin,expected:net,actual});
  }
  const nets=structuredClone(baselineNets||{});
  for(const c of model.components||[])if(!nets[c.designator]){
    nets[c.designator]={};
    for(const p of c.pins||[])nets[c.designator][p.num]=recovered[c.designator]?.[p.num]||'';
    for(const p of c.pins||[])if(!p.noConnected&&!nets[c.designator][p.num])mismatches.push({ref:c.designator,pin:p.num,expected:'connected',actual:''});
  }
  return{nets,mismatches,recovered};
}

export function predictSourceCandidate(candidateSource,{baselineSource,baselineGeometry,baselineNets,componentTypes={}}={}){
  if(!baselineSource||!baselineGeometry)throw Error('Source candidate twin needs baseline source and complete geometry');
  const before=indexSource(baselineSource),after=indexSource(candidateSource);
  const font=calibrateFont(baselineGeometry.components||[]);
  const baseParts=new Map((baselineGeometry.components||[]).map(c=>[c.id,c]));
  const baseFlags=new Map((baselineGeometry.netflags||[]).filter(f=>f.id&&f.kind!=='sig').map(f=>[f.id,f]));
  const donorByIdentity=new Map();
  for(const r of before.records.filter(r=>r.head.type==='COMPONENT')){
    const donor=baseParts.get(r.head.id)||baseFlags.get(r.head.id),key=donorKey(before,r);
    if(donor&&!donorByIdentity.has(key))donorByIdentity.set(key,donor);
  }
  const components=[],netflags=[],donorFailures=[];
  for(const r of after.records.filter(r=>r.head.type==='COMPONENT')){
    if(componentTypes[r.head.id]==='sheet')continue;
    const designator=attrValue(after,r.head.id,'Designator');
    const globalNet=attrValue(after,r.head.id,'Global Net Name');
    if(!designator&&!globalNet){donorFailures.push({id:r.head.id,kind:'component-role-unknown'});continue;}
    const donor=baseParts.get(r.head.id)||baseFlags.get(r.head.id)||donorByIdentity.get(donorKey(after,r));
    if(!donor){donorFailures.push({id:r.head.id,kind:'geometry-donor-missing',partId:r.atom.partId});continue;}
    const pos={x:r.atom.x,y:-r.atom.y};
    if(designator){
      const placed=placeGeom(localGeom(donor),pos.x,pos.y,r.atom.rotation||0,!!r.atom.isMirror);
      const attrs=candidateAttrs(after,r.head.id,donor,font,before);
      const value=attrs.find(a=>a.key==='Value')?.value||attrs.find(a=>a.key==='Name')?.value||'';
      components.push({id:r.head.id,designator:String(designator),name:attrs.find(a=>a.key==='Name')?.value||null,value,
        x:pos.x,y:pos.y,rotation:r.atom.rotation||0,mirror:!!r.atom.isMirror,bbox:placed.bbox,pins:placed.pins,attrs});
    }else{
      const samePose=(donor.rotation||0)===(r.atom.rotation||0)&&!!donor.mirror===!!r.atom.isMirror;
      const bbox=samePose?transformBox(donor.bbox,donor,pos):placeGeom(localGeom({...donor,attrs:[],pins:[]}),pos.x,pos.y,r.atom.rotation||0,!!r.atom.isMirror).bbox;
      const attrs=candidateAttrs(after,r.head.id,{attrs:[],...donor},font,before);
      const gnn=attrs.find(a=>a.key==='Global Net Name');
      netflags.push({id:r.head.id,type:'netflag',net:String(globalNet),x:pos.x,y:pos.y,rotation:r.atom.rotation||0,mirror:!!r.atom.isMirror,
        bbox,nameBox:gnn?.bbox||null,nameAlign:gnn?.align||null,nameRotation:gnn?.rotation??0,
        nameVisible:((after.attrs.get(r.head.id)||[]).find(a=>a.atom.key==='Global Net Name')?.atom?.valueVisible!==false)});
    }
  }
  if(donorFailures.length)throw Error(`Source candidate twin cannot prove geometry: ${JSON.stringify(donorFailures)}`);
  const oldWireNets=baselineWireNets(baselineGeometry),wires=[];
  for(const [wireId,lines] of after.lines){
    const explicit=String(attrValue(after,wireId,'NET')||'').trim();const net=explicit||oldWireNets.get(wireId)||'';
    for(let i=0;i<lines.length;i++){const a=lines[i].atom;wires.push({id:`${wireId}#${i}`,net,line:[a.startX,-a.startY,a.endX,-a.endY]});}
  }
  const texts=(baselineGeometry.texts||[]).map(x=>structuredClone(x));
  const rectangles=(baselineGeometry.rectangles||[]).map(x=>structuredClone(x));
  const model={components,netflags,wires,texts,rectangles,sheetEvidence:structuredClone(baselineGeometry.sheetEvidence||null)};
  const sourcePinNets=assertNamedPinsHaveNamedWireRoots({index:after,rootLines:after.lines,components,netflags,baselineNets,oldWireNets,
    baselineRootIds:new Set(before.lines.keys())});
  const connectivity=reconcileNets(model,baselineNets,sourcePinNets);
  if(connectivity.mismatches.length)throw Error(`Source candidate connectivity mismatch: ${JSON.stringify(connectivity.mismatches)}`);
  // Recovered names complete newly added unnamed branches; existing source wire
  // identities retain their authoritative baseline names above.
  const pinToNet=connectivity.recovered;
  for(const w of wires)if(!w.net){
    for(const c of components)for(const p of c.pins||[])if(pinToNet[c.designator]?.[p.num]&&
      ((p.x===w.line[0]&&p.y===w.line[1])||(p.x===w.line[2]&&p.y===w.line[3])))w.net=pinToNet[c.designator][p.num];
  }
  return{model,nets:connectivity.nets,evidence:{sourceDerived:true,connectivity:{pass:true,mismatches:[]}}};
}

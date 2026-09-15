// Generic source repair for visible endpoint text. Circuit names and roles are
// inferred from source attributes; no project-specific literals are accepted.
const isGround = n => /(^|[_\-./])(a|d|p)?gnd\d*([_\-./]|$)|(^|[_\-./])v(ss|ee)\d*([_\-./]|$)/i.test(String(n || ''));

export function planEndpointTextCleanup(records){
  const edit=new Map(),findings=[],attrsByParent=new Map();
  for(const r of records||[]){
    if(r.head?.type!=='ATTR')continue;
    if(!attrsByParent.has(r.atom.parentId))attrsByParent.set(r.atom.parentId,[]);
    attrsByParent.get(r.atom.parentId).push(r);
    if(r.atom.key!=='NET'||r.atom.valueVisible!==true)continue;
    if(String(r.atom.value||'').trim()){
      const rotation=r.atom.rotation==null?0:Number(r.atom.rotation);
      if(Number.isFinite(rotation)&&((rotation%180)+180)%180!==0){
        edit.set(r.head.id,{...r.atom,rotation:null});
        findings.push({kind:'make-net-label-horizontal',id:r.head.id,net:r.atom.value,rotation});
      }
    }
  }
  for(const r of records||[]){
    if(r.head?.type!=='COMPONENT')continue;
    const aa=attrsByParent.get(r.head.id)||[];
    const g=aa.find(a=>a.atom.key==='Global Net Name');
    if(!g||!String(g.atom.value||'').trim()||isGround(g.atom.value))continue;
    const name=aa.find(a=>a.atom.key==='Name');
    const pose=((Number(r.atom.rotation)||0)%360+360)%360;
    const sidePlacement=pose===90
      ? {x:r.atom.x-15,y:r.atom.y,align:'RIGHT_MIDDLE'}
      : pose===270
        ? {x:r.atom.x+15,y:r.atom.y,align:'LEFT_MIDDLE'}
        : null;
    if(g.atom.valueVisible===false&&(!name||name.atom.valueVisible===false)){
      const placement=sidePlacement||{x:r.atom.x,y:r.atom.y,align:pose===180?'CENTER_TOP':'CENTER_BOTTOM'};
      edit.set(g.head.id,{...g.atom,...placement,rotation:0,valueVisible:true,keyVisible:false});
      findings.push({kind:'show-power-net-name',id:r.head.id,net:g.atom.value});
    }else{
      const rotation=g.atom.rotation==null?0:Number(g.atom.rotation);
      const sideNeedsCenter=sidePlacement&&(
		g.atom.x!==sidePlacement.x||g.atom.y!==sidePlacement.y||g.atom.align!==sidePlacement.align
	  );
	  if(Number.isFinite(rotation)&&((rotation%180)+180)%180!==0||sideNeedsCenter){
		edit.set(g.head.id,{...g.atom,...(sidePlacement||{}),rotation:0,valueVisible:true,keyVisible:false});
        findings.push({kind:'make-power-name-horizontal',id:r.head.id,net:g.atom.value,rotation});
      }
    }
  }
  return{edit,drop:new Set(),add:[],findings,pass:true};
}

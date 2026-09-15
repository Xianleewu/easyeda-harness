/* Build measured module/cell boxes from live geometry and declarative membership. */

const emptyBox = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const finiteBox = b => b && [b.minX,b.minY,b.maxX,b.maxY].every(Number.isFinite);
const extend = (box, item) => {
	if (!finiteBox(item)) return;
	box.minX=Math.min(box.minX,item.minX); box.minY=Math.min(box.minY,item.minY);
	box.maxX=Math.max(box.maxX,item.maxX); box.maxY=Math.max(box.maxY,item.maxY);
};
const pointBox = (x1,y1,x2,y2) => ({minX:Math.min(x1,x2),minY:Math.min(y1,y2),maxX:Math.max(x1,x2),maxY:Math.max(y1,y2)});
const onSegment = (x,y,line,eps=1e-6) => {
	const [x1,y1,x2,y2]=line;
	if(Math.abs(x1-x2)<=eps)return Math.abs(x-x1)<=eps&&y>=Math.min(y1,y2)-eps&&y<=Math.max(y1,y2)+eps;
	if(Math.abs(y1-y2)<=eps)return Math.abs(y-y1)<=eps&&x>=Math.min(x1,x2)-eps&&x<=Math.max(x1,x2)+eps;
	return false;
};

export function buildRegionEvidence(model, definitions, { padding = 10, requireComplete = false } = {}) {
	const defs=(definitions||[]).map(d=>({...d,id:d.id||d.name||d.role||'?',members:[...(d.members||[])]}));
	const componentByRef=new Map((model.components||[]).map(c=>[c.designator,c]));
	const regionOfRef=new Map();
	for(const d of defs)for(const ref of d.members){
		if(regionOfRef.has(ref))throw new Error(`Component belongs to multiple regions: ${ref}`);
		if(!componentByRef.has(ref))throw new Error(`Region member is missing: ${ref}`);
		regionOfRef.set(ref,d.id);
	}
	if(requireComplete){
		const missing=[...componentByRef.keys()].filter(ref=>ref&&!regionOfRef.has(ref));
		if(missing.length)throw new Error(`Region coverage is incomplete: ${missing.join(',')}`);
	}
	const boxes=new Map(defs.map(d=>[d.id,emptyBox()]));
	for(const d of defs)for(const ref of d.members){
		const c=componentByRef.get(ref),box=boxes.get(d.id); extend(box,c.bbox);
		for(const a of c.attrs||[])if((a.valueVisible||a.keyVisible)&&a.bbox&&
			(a.bbox.maxX>a.bbox.minX||a.bbox.maxY>a.bbox.minY))extend(box,a.bbox);
	}

	const wires=model.wires||[], parent=wires.map((_,i)=>i);
	const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
	const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
	for(let i=0;i<wires.length;i++)for(let j=i+1;j<wires.length;j++){
		if(String(wires[i].net||'')!==String(wires[j].net||''))continue;
		const a=wires[i].line||[],b=wires[j].line||[];
		if(a.length<4||b.length<4)continue;
		if(onSegment(a[0],a[1],b)||onSegment(a[2],a[3],b)||onSegment(b[0],b[1],a)||onSegment(b[2],b[3],a))join(i,j);
	}
	const graphs=new Map(); for(let i=0;i<wires.length;i++){const root=find(i);if(!graphs.has(root))graphs.set(root,[]);graphs.get(root).push(wires[i]);}
	const info=[...graphs.values()].map(ws=>{
		const owners=new Set();
		for(const c of model.components||[])for(const pin of c.pins||[])if(ws.some(w=>onSegment(pin.x,pin.y,w.line||[]))){const id=regionOfRef.get(c.designator);if(id)owners.add(id);}
		return {ws,owners,net:String(ws.find(w=>w.net)?.net||'')};
	});
	const ownersByNet=new Map(); for(const g of info)if(g.net&&g.owners.size){if(!ownersByNet.has(g.net))ownersByNet.set(g.net,new Set());for(const id of g.owners)ownersByNet.get(g.net).add(id);}
	for(const g of info){
		// A built-in power/ground flag terminates a visually local branch. Equal
		// supply names elsewhere on the sheet are logically common, but they do
		// not turn each disconnected flag branch into a page-wide corridor.
		// Signal-label branches keep the grouped-net corridor behavior below.
		const localFlags=(model.netflags||[]).filter(f=>f.kind!=='sig'&&String(f.net||'')===g.net&&g.ws.some(w=>onSegment(f.x??f.textX,f.y??f.textY,w.line||[])));
		const allOwners=localFlags.length?g.owners:(g.net?(ownersByNet.get(g.net)||g.owners):g.owners);
		if(allOwners.size!==1)continue;
		const id=[...allOwners][0],box=boxes.get(id); if(!box)continue;
		for(const w of g.ws){
			const l=w.line||[];if(l.length>=4)extend(box,pointBox(l[0],l[1],l[2],l[3]));
			/* Runtime exposes zero-area placeholder boxes for hidden wire attributes
			 * at (0,0).  They are metadata, not rendered region content. */
			for(const a of w.attrs||[])if((a.valueVisible||a.keyVisible)&&a.bbox&&
				(a.bbox.maxX>a.bbox.minX||a.bbox.maxY>a.bbox.minY))extend(box,a.bbox);
		}
		for(const f of model.netflags||[])if(String(f.net||'')===g.net&&g.ws.some(w=>onSegment(f.x??f.textX,f.y??f.textY,w.line||[]))){
			if(f.bbox&&(f.bbox.maxX>f.bbox.minX||f.bbox.maxY>f.bbox.minY))extend(box,f.bbox);
			if(f.nameBox&&(f.nameBox.maxX>f.nameBox.minX||f.nameBox.maxY>f.nameBox.minY))extend(box,f.nameBox);
		}
	}
	return defs.map(d=>{
		const contentBox=boxes.get(d.id);
		if(!finiteBox(contentBox))throw new Error(`Region has no measurable content: ${d.id}`);
		return {...d,contentBox,box:{minX:contentBox.minX-padding,minY:contentBox.minY-padding,maxX:contentBox.maxX+padding,maxY:contentBox.maxY+padding}};
	});
}

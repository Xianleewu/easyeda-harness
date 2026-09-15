// Normalize visible EasyEDA wire NET attributes from their actual horizontal
// free-end geometry. This module is circuit-agnostic and never trusts the
// label's existing align value to decide which side it belongs to.
import {createHash} from 'node:crypto';
const near=(a,b,t=1)=>Math.abs(a-b)<=t;

export function planSourceLabelOrigins(records,{ignoreIds=[],charWidth=7,textClearance=10,grid=10}={}){
	const ignored=new Set(ignoreIds),linesByWire=new Map(),edit=new Map(),findings=[],checked=[],add=[],drop=new Set();
	const usedIds=new Set((records||[]).map(r=>r.head?.id).filter(Boolean));
	const makeId=(seed,i=0)=>{let n=i,id;do{id=createHash('sha256').update(`${seed}:${n++}`).digest('hex').slice(0,16);}while(usedIds.has(id));usedIds.add(id);return id;};
	for(const r of records||[])if(r.head?.type==='LINE'&&r.atom?.lineGroup){
		if(!linesByWire.has(r.atom.lineGroup))linesByWire.set(r.atom.lineGroup,[]);
		linesByWire.get(r.atom.lineGroup).push(r);
	}
	for(const r of records||[]){
		const a=r.atom||{};
		if(r.head?.type!=='ATTR'||a.key!=='NET'||a.valueVisible!==true||!String(a.value||'').trim()||ignored.has(r.head.id))continue;
		const incident=[];
		for(const line of linesByWire.get(a.parentId)||[]){
			const q=line.atom;
			if(near(q.startX,a.x)&&near(q.startY,a.y))incident.push({line,other:[q.endX,q.endY]});
			else if(near(q.endX,a.x)&&near(q.endY,a.y))incident.push({line,other:[q.startX,q.startY]});
		}
		const horizontal=incident.filter(x=>near(x.line.atom.startY,x.line.atom.endY));
		if(incident.length!==1||horizontal.length!==1){
			findings.push({kind:incident.length?'label-anchor-not-free-horizontal-end':'label-anchor-off-wire',id:r.head.id,net:a.value,at:[a.x,a.y],incident:incident.length,horizontalEnds:horizontal.length});
			continue;
		}
		const incidentLine=horizontal[0].line,firstOther=horizontal[0].other[0];
		if(near(firstOther,a.x)){findings.push({kind:'label-horizontal-side-unknown',id:r.head.id,net:a.value,at:[a.x,a.y]});continue;}
		const side=firstOther>a.x?'left':'right';
		// Follow a previously segmented collinear escape to its circuit-side
		// endpoint. Looking only at the first 50-unit piece would make repeated
		// normalization drift the label farther out on every run.
		let lo=Math.min(a.x,firstOther),hi=Math.max(a.x,firstOther),changed=true;
		const chain=[];
		while(changed){changed=false;for(const line of linesByWire.get(a.parentId)||[]){const q=line.atom;if(!near(q.startY,a.y)||!near(q.endY,a.y))continue;
			const qlo=Math.min(q.startX,q.endX),qhi=Math.max(q.startX,q.endX);if(qlo<=hi+1&&qhi>=lo-1){if(!chain.includes(line))chain.push(line);const nl=Math.min(lo,qlo),nh=Math.max(hi,qhi);if(nl!==lo||nh!==hi){lo=nl;hi=nh;changed=true;}}}}
		const ox=side==='left'?hi:lo;
		const align=side==='left'?'LEFT_BOTTOM':'RIGHT_BOTTOM';
		const width=Math.max(1,String(a.value).length)*charWidth;
		const branches=(linesByWire.get(a.parentId)||[]).filter(x=>{
			const q=x.atom;if(!near(q.startX,q.endX))return false;
			return (near(q.startY,a.y)||near(q.endY,a.y))&&q.startX>Math.min(a.x,ox)&&q.startX<Math.max(a.x,ox);
		}).map(x=>x.atom.startX);
		let x=a.x;
		// The documented anchor is the outer text edge and the glyphs expand
		// toward the circuit. Reserve the measured text width plus clearance
		// between that outer edge and the connected end.
		if(side==='left')x=Math.min(x,Math.floor((ox-width-textClearance)/grid)*grid);
		else x=Math.max(x,Math.ceil((ox+width+textClearance)/grid)*grid);
		if(side==='left'&&branches.length){
			const limit=Math.min(...branches)-width-textClearance;
			if(x>limit)x=Math.floor(limit/grid)*grid;
		}else if(side==='right'&&branches.length){
			const limit=Math.max(...branches)+width+textClearance;
			if(x<limit)x=Math.ceil(limit/grid)*grid;
		}
		checked.push({id:r.head.id,net:a.value,side,align,fromX:a.x,toX:x,label:r,line:incidentLine,chain,otherX:ox});
	}
	// Preserve existing visual columns: if any member needs more clearance, move
	// the whole same-side column to the farthest required outer edge.
	const columns=new Map();
	for(const c of checked){const k=`${c.side}|${Math.round(c.fromX/grid)}`;if(!columns.has(k))columns.set(k,[]);columns.get(k).push(c);}
	for(const col of columns.values()){
		const target=col[0].side==='left'?Math.min(...col.map(c=>c.toX)):Math.max(...col.map(c=>c.toX));
		for(const c of col){
			const a=c.label.atom,q=c.line.atom,y=a.y,total=Math.abs(c.otherX-target),dir=Math.sign(c.otherX-target);
			if(!near(target,a.x)){
				for(const line of c.chain)if(line.head.id!==c.line.head.id)drop.add(line.head.id);
				// Keep each LINE at or below 50 units. All pieces retain the same
				// lineGroup, so EasyEDA compiles them as one electrical WIRE root.
				const points=[target]; for(let x=target;Math.abs(c.otherX-x)>50;){x+=dir*50;points.push(x);} points.push(c.otherX);
				const segments=[];for(let i=0;i+1<points.length;i++)segments.push({...q,startX:points[i],startY:y,endX:points[i+1],endY:y,lineGroup:q.lineGroup});
				edit.set(c.line.head.id,segments[0]);
				for(let i=1;i<segments.length;i++)add.push({head:{type:'LINE',id:makeId(c.line.head.id,i)},atom:segments[i]});
			}
			const rotation=a.rotation==null?0:Number(a.rotation);
			if(a.align!==c.align||!near(target,a.x)||rotation%360!==0)
				edit.set(c.label.head.id,{...a,x:target,align:c.align,rotation:null});
			c.toX=target;c.segmentCount=total?Math.ceil(total/50):0;
		}
	}
	return{edit,add,drop,findings,checked:checked.map(({label,line,chain,...x})=>x),pass:findings.length===0};
}

export function planSourceLabelColumn(records,{labelIds,x}={}){
	const wanted=new Set(labelIds||[]),byId=new Map((records||[]).map(r=>[r.head?.id,r])),edit=new Map(),findings=[];
	for(const id of wanted){
		const r=byId.get(id),a=r?.atom||{};
		if(r?.head?.type!=='ATTR'||a.key!=='NET'||!Number.isFinite(x)){findings.push({kind:'invalid-label-column-member',id});continue;}
		const incident=(records||[]).filter(q=>q.head?.type==='LINE'&&q.atom?.lineGroup===a.parentId&&
			((near(q.atom.startX,a.x)&&near(q.atom.startY,a.y))||(near(q.atom.endX,a.x)&&near(q.atom.endY,a.y))));
		const horizontal=incident.filter(q=>near(q.atom.startY,q.atom.endY));
		if(incident.length!==1||horizontal.length!==1){findings.push({kind:'column-member-not-horizontal-free-end',id});continue;}
		const line=horizontal[0],q=line.atom,start=near(q.startX,a.x)&&near(q.startY,a.y);
		const otherX=start?q.endX:q.startX;
		if((a.align==='LEFT_BOTTOM'&&x>=otherX)||(a.align==='RIGHT_BOTTOM'&&x<=otherX)){
			findings.push({kind:'column-move-crosses-connected-end',id,x,otherX});continue;
		}
		edit.set(id,{...a,x});
		edit.set(line.head.id,start?{...q,startX:x}:{...q,endX:x});
	}
	return{edit,findings,pass:findings.length===0};
}

// 几何/视觉自检：器件重叠、标签重叠、线压器件、出格、导线交叉
import { readFileSync } from 'node:fs';

export function geomQC(model, opt = {}) {
	const grid = opt.grid || 10;
	const comps = model.components.filter(c => c.bbox);
	const flags = (model.netflags || []);
	const rects = [];
	for (const t of model.texts || []) if (t.bbox) rects.push({ id:t.id||null, kind:'text', tag: `text:${t.id || t.text}`, ...t.bbox });
	for (const c of comps) rects.push({ id:c.id||null, kind:'component', tag: c.designator, ...c.bbox });
	for (const f of flags) if (f.bbox) rects.push({ id:f.id||null, kind:'netflag', net:f.net||'', tag: `[${f.net}]`, minX: f.bbox.minX, minY: f.bbox.minY, maxX: f.bbox.maxX, maxY: f.bbox.maxY });
	/* DR4/DR5(docs/schematic-design-rules.md):可见 attribute/text bbox 也是不可重叠的可见对象。
	 * DR4:attribute vs attribute、attribute vs flag 互不重叠。
	 * DR5:attribute bbox 不得压覆其它器件本体。
	 * 不可见标注(valueVisible 与 keyVisible 均非真)不纳入审计。 */
	for (const c of model.components || []) {
		for (const a of (c.attrs || [])) {
			if (!a.bbox || !(a.valueVisible || a.keyVisible)) continue;
			rects.push({ id:a.id||null, parentId:c.id||null, kind:'attribute', tag: `attr:${c.designator}.${a.key || '?'}`, minX: a.bbox.minX, minY: a.bbox.minY, maxX: a.bbox.maxX, maxY: a.bbox.maxY });
		}
	}
	/* 标题栏/信息栏区域(model._titleBlock,真 bbox:live getPrimitivesBBox 读 / 源 frame 文字范围读,非猜)。
	 * 作为不可侵占的可见对象 → 任何器件/标签/符号压入即报(治 FPC1 压标题栏)。 */
	if (model._titleBlock && Number.isFinite(model._titleBlock.minX)) {
		rects.push({ id:null, kind:'title-block', tag: 'TITLEBLOCK', minX: model._titleBlock.minX, minY: model._titleBlock.minY, maxX: model._titleBlock.maxX, maxY: model._titleBlock.maxY });
	}

	const ov = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
	const inset = (r, m) => ({ minX: r.minX + m, minY: r.minY + m, maxX: r.maxX - m, maxY: r.maxY - m });

	// 1) 矩形互相重叠（器件/标签 bbox）
	const overlaps = [], overlapDetails=[];
	for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
		if (ov(inset(rects[i], 1), inset(rects[j], 1))) {
			overlaps.push(`${rects[i].tag} x ${rects[j].tag}`);
			const item=r=>({id:r.id,parentId:r.parentId,kind:r.kind,tag:r.tag,net:r.net,bbox:{minX:r.minX,minY:r.minY,maxX:r.maxX,maxY:r.maxY}});
			overlapDetails.push({a:item(rects[i]),b:item(rects[j])});
		}

	// 2) 导线段穿过器件 bbox 内部
	const segs = [];
	for (const [wireIndex,w] of (model.wires || []).entries()) for (let i = 0; i + 3 < (w.line || []).length; i += 2) {
		const a = [w.line[i], w.line[i + 1]], b = [w.line[i + 2], w.line[i + 3]];
		const group=String(w.id||`anonymous-${wireIndex}`).replace(/#\d+$/,'');
		const net=String(w.net||'');
		if (a[0] === b[0] && a[1] === b[1]) continue; segs.push({ a, b, net, group });
	}
	/* Resolve unnamed electrical identity from actual drawable connectivity.
	 * Separate wire primitives often form one net through a shared endpoint or a
	 * T-junction. Treating every primitive as a different unnamed net reports the
	 * archetype's own branches as shorts. Conversely, a mid-span crossing has no
	 * endpoint/junction evidence and must remain two identities so DR2 can catch it.
	 * A named net propagates through an attached unnamed branch; two different
	 * names never merge, leaving the contact visible to the short checks below. */
	const segPar = segs.map((_, i) => i);
	const segNames = segs.map(s => new Set(s.net ? [s.net] : []));
	const segFind = i => { while (segPar[i] !== i) { segPar[i] = segPar[segPar[i]]; i = segPar[i]; } return i; };
	const compatible = (a, b) => !a.size || !b.size || (a.size === 1 && b.size === 1 && [...a][0] === [...b][0]);
	const segUnion = (i, j) => {
		let a = segFind(i), b = segFind(j); if (a === b || !compatible(segNames[a], segNames[b])) return false;
		if (a > b) [a, b] = [b, a];
		segPar[b] = a; for (const n of segNames[b]) segNames[a].add(n); return true;
	};
	const samePoint = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
	const pointOnInterior = (p, s) => {
		if (samePoint(p, s.a) || samePoint(p, s.b)) return false;
		if (s.a[1] === s.b[1]) return Math.abs(p[1] - s.a[1]) < 1e-7 && p[0] > Math.min(s.a[0], s.b[0]) && p[0] < Math.max(s.a[0], s.b[0]);
		if (s.a[0] === s.b[0]) return Math.abs(p[0] - s.a[0]) < 1e-7 && p[1] > Math.min(s.a[1], s.b[1]) && p[1] < Math.max(s.a[1], s.b[1]);
		return false;
	};
	const collinearInteriorOverlap = (s, t) => {
		if (s.a[1] === s.b[1] && t.a[1] === t.b[1] && s.a[1] === t.a[1])
			return Math.max(Math.min(s.a[0], s.b[0]), Math.min(t.a[0], t.b[0])) < Math.min(Math.max(s.a[0], s.b[0]), Math.max(t.a[0], t.b[0]));
		if (s.a[0] === s.b[0] && t.a[0] === t.b[0] && s.a[0] === t.a[0])
			return Math.max(Math.min(s.a[1], s.b[1]), Math.min(t.a[1], t.b[1])) < Math.min(Math.max(s.a[1], s.b[1]), Math.max(t.a[1], t.b[1]));
		return false;
	};
	for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
		const sameWire = segs[i].group === segs[j].group;
		const endpointContact = [segs[i].a, segs[i].b].some(a => [segs[j].a, segs[j].b].some(b => samePoint(a, b)));
		const tee = [segs[i].a, segs[i].b].some(p => pointOnInterior(p, segs[j])) || [segs[j].a, segs[j].b].some(p => pointOnInterior(p, segs[i]));
		if (sameWire || endpointContact || tee || collinearInteriorOverlap(segs[i], segs[j])) segUnion(i, j);
	}
	for (let i = 0; i < segs.length; i++) {
		const root = segFind(i), names = segNames[root];
		segs[i].electrical = names.size === 1 ? [...names][0] : `@unnamed:${segs[root].group}`;
	}
	const segInRect = (s, r) => { // 仅判轴向线段是否穿过矩形内部（端点贴边不算）
		const ri = inset(r, 1);
		if (s.a[0] === s.b[0]) { const x = s.a[0]; if (x <= ri.minX || x >= ri.maxX) return false; const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]); return y0 < ri.maxY && y1 > ri.minY; }
		if (s.a[1] === s.b[1]) { const y = s.a[1]; if (y <= ri.minY || y >= ri.maxY) return false; const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]); return x0 < ri.maxX && x1 > ri.minX; }
		return false;
	};
	const wireThruComp = [];
	for (const s of segs) for (const c of comps) {
		if (!segInRect(s, c.bbox)) continue;
		// 排除连该件【自己脚】的线段:脚在体框外的件(电阻/电容等)连脚的内部线会穿体框,但 EDA 渲染时
		// 符号盖住该线 = 非视觉缺陷(preserve 真实板大量此类,generate 板脚在bbox边不触发)。真穿(连别件、
		// 段穿本件体)端点不在本件脚 → 仍报(如 fuzz 测的邻件脚穿入本件体)。
		if ((c.pins || []).length===2&&(c.pins || []).some(p => (Math.abs(s.a[0] - p.x) < 2 && Math.abs(s.a[1] - p.y) < 2) || (Math.abs(s.b[0] - p.x) < 2 && Math.abs(s.b[1] - p.y) < 2))) continue;
		wireThruComp.push(`net=${s.net || ''} thru ${c.designator}`);
	}

	// 2b) 导线内部压到引脚（非端点）→ 短路外部脚:EDA 拒建此类线（wireThruComp 只查
	//     本体 bbox,漏了伸出本体外的引脚;这是 live 写回丢线的真实根因）。
	const pins = [];
	for (const c of comps) for (const p of (c.pins || [])) pins.push({ ref: `${c.designator}.${p.num}`, x: p.x, y: p.y, noConnected: p.noConnected === true });
	const ptOnSegInterior = (px, py, s) => {
		const [ax, ay] = s.a, [bx, by] = s.b;
		if ((Math.abs(px - ax) < 1 && Math.abs(py - ay) < 1) || (Math.abs(px - bx) < 1 && Math.abs(py - by) < 1)) return false; // 端点不算
		if (ay === by) return Math.abs(py - ay) < 1 && px > Math.min(ax, bx) && px < Math.max(ax, bx);
		if (ax === bx) return Math.abs(px - ax) < 1 && py > Math.min(ay, by) && py < Math.max(ay, by);
		return false;
	};
	const pointOnSeg = (px, py, s) => {
		const [ax, ay] = s.a, [bx, by] = s.b;
		if (ay === by) return Math.abs(py - ay) < 1 && px >= Math.min(ax, bx) - 1 && px <= Math.max(ax, bx) + 1;
		if (ax === bx) return Math.abs(px - ax) < 1 && py >= Math.min(ay, by) - 1 && py <= Math.max(ay, by) + 1;
		return false;
	};
	const wireThruPin = [];
	for (const s of segs) for (const p of pins) if (ptOnSegInterior(p.x, p.y, s)) wireThruPin.push(`net=${s.net || ''} thru pin ${p.ref}`);
	// DR33: a wire must leave an external symbol terminal along the pin's
	// outward axis. Native electrical DRC cannot distinguish a normal escape
	// from a segment that first doubles back into the symbol body.
	for (const c of comps) {
		// A perpendicular rail may legitimately meet a two-terminal passive at
		// its pin endpoint. Apply directional pin escapes to multi-pin symbols,
		// where the body side and external fanout are unambiguous.
		if ((c.pins || []).length <= 2) continue;
		for (const p of (c.pins || [])) {
		const b = c.bbox, eps = 1;
		let outward = null;
		if (p.x < b.minX - eps && p.y >= b.minY - eps && p.y <= b.maxY + eps) outward = [-1, 0];
		else if (p.x > b.maxX + eps && p.y >= b.minY - eps && p.y <= b.maxY + eps) outward = [1, 0];
		else if (p.y < b.minY - eps && p.x >= b.minX - eps && p.x <= b.maxX + eps) outward = [0, -1];
		else if (p.y > b.maxY + eps && p.x >= b.minX - eps && p.x <= b.maxX + eps) outward = [0, 1];
		if (!outward) continue;
		for (const s of segs) {
			let q = null;
			if (samePoint([p.x, p.y], s.a)) q = s.b;
			else if (samePoint([p.x, p.y], s.b)) q = s.a;
			else continue;
			const dx = q[0] - p.x, dy = q[1] - p.y;
			const along = dx * outward[0] + dy * outward[1];
			const cross = dx * outward[1] - dy * outward[0];
			if (along <= 0 || Math.abs(cross) > 1e-7)
				wireThruPin.push(`net=${s.net || ''} pin-escape-inward ${c.designator}.${p.num} from=(${p.x},${p.y}) to=(${q[0]},${q[1]})`);
		}
		}
	}
	// A built-in NoConnected marker is an electrical state, not decoration. Any
	// drawable wire touching that pin is contradictory even when the contact is
	// at a segment endpoint, which the ordinary through-pin test intentionally
	// permits for connected pins.
	for (const p of pins) if (p.noConnected) {
		for (const s of segs) if (pointOnSeg(p.x, p.y, s)) {
			wireThruPin.push(`net=${s.net || ''} wire-to-no-connect ${p.ref}`);
			break;
		}
	}
	// A bus must sit outside a multi-pin symbol with short perpendicular taps.
	// Running the bus directly on the pin endpoint column is electrically
	// ambiguous and produces the cramped vertical strokes seen on connectors.
	for(const c of comps){
		if((c.pins||[]).length<=2)continue;
		const groups=new Map();
		for(const s of segs){
			const vertical=s.a[0]===s.b[0],horizontal=s.a[1]===s.b[1];if(!vertical&&!horizontal)continue;
			const fixed=vertical?s.a[0]:s.a[1],lo=Math.min(vertical?s.a[1]:s.a[0],vertical?s.b[1]:s.b[0]),hi=Math.max(vertical?s.a[1]:s.a[0],vertical?s.b[1]:s.b[0]);
			const k=`${vertical?'V':'H'}|${fixed}|${s.electrical}`;if(!groups.has(k))groups.set(k,{vertical,fixed,net:s.net||'',electrical:s.electrical,ranges:[]});groups.get(k).ranges.push([lo,hi]);
		}
		for(const g of groups.values()){
			const merged=[];for(const r of g.ranges.sort((a,b)=>a[0]-b[0])){const last=merged.at(-1);if(last&&r[0]<=last[1]+1e-6)last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}
			for(const [lo,hi] of merged){
				const hit=(c.pins||[]).filter(p=>{
					const along=g.vertical?p.y:p.x;
					if(along<lo-1||along>hi+1)return false;
					return segs.some(s=>{
					if(s.electrical!==g.electrical)return false;
						if(g.vertical&&s.a[1]===s.b[1]&&Math.abs(s.a[1]-p.y)<1)
							return Math.min(s.a[0],s.b[0])<=Math.min(p.x,g.fixed)+1&&Math.max(s.a[0],s.b[0])>=Math.max(p.x,g.fixed)-1;
						if(!g.vertical&&s.a[0]===s.b[0]&&Math.abs(s.a[0]-p.x)<1)
							return Math.min(s.a[1],s.b[1])<=Math.min(p.y,g.fixed)+1&&Math.max(s.a[1],s.b[1])>=Math.max(p.y,g.fixed)-1;
						return false;
					});
				});
				if(hit.length<2)continue;
				const escape=Math.min(...hit.map(p=>Math.abs((g.vertical?p.x:p.y)-g.fixed)));
				if(escape<1)wireThruPin.push(`net=${g.net} bus-on-pin-column ${c.designator}.${hit.map(p=>p.num).join(',')}`);
				else if(escape<10)wireThruPin.push(`net=${g.net} bus-too-close-to-pin-column ${c.designator}.${hit.map(p=>p.num).join(',')} clearance=${escape}`);
				for(const p of hit){
					const branches=segs.filter(s=>s.electrical===g.electrical&&(g.vertical?s.a[1]===s.b[1]&&Math.abs(s.a[1]-p.y)<1:s.a[0]===s.b[0]&&Math.abs(s.a[0]-p.x)<1));
					for(const s of branches){
						const a=g.vertical?s.a[0]:s.a[1],b=g.vertical?s.b[0]:s.b[1],pin=g.vertical?p.x:p.y;
						if(Math.min(a,b)>Math.min(pin,g.fixed)+1||Math.max(a,b)<Math.max(pin,g.fixed)-1)continue;
						const over=g.fixed>pin?Math.max(a,b)-g.fixed:g.fixed-Math.min(a,b);
						if(over>1)wireThruPin.push(`net=${g.net} bus-branch-overhang ${c.designator}.${p.num} overhang=${over}`);
					}
				}
			}
		}
	}

	// 3) 出格（引脚 / 导线点不在栅格）
	let offgrid = 0; const offEx = [];
	const onGrid = v => Math.abs(v - Math.round(v / grid) * grid) <= 1e-7;
	const chk = (x, y, tag) => { if (!onGrid(x) || !onGrid(y)) { offgrid++; if (offEx.length < 8) offEx.push(`${tag}(${x},${y})`); } };
	for (const c of comps) for (const p of c.pins || []) chk(p.x, p.y, c.designator);

	// 4) 导线交叉（不同 net 的正交线相交于非端点）
	let crossings = 0; const crossEx = [];
	const H = segs.filter(s => s.a[1] === s.b[1]); const V = segs.filter(s => s.a[0] === s.b[0]);
	for (const h of H) for (const v of V) {
		const hx0 = Math.min(h.a[0], h.b[0]), hx1 = Math.max(h.a[0], h.b[0]), hy = h.a[1];
		const vy0 = Math.min(v.a[1], v.b[1]), vy1 = Math.max(v.a[1], v.b[1]), vx = v.a[0];
		if (vx > hx0 && vx < hx1 && hy > vy0 && hy < vy1 && h.electrical !== v.electrical) { crossings++; if (crossEx.length < 8) crossEx.push(`${h.net||h.electrical}x${v.net||v.electrical}@(${vx},${hy})`); }
	}

	// 5) 共线异网重叠（两段同 y/同 x、范围内部重叠、异网 = 电气短路；上面的正交点相交检测漏掉这类）
	let collinear = 0; const collEx = [];
	const Hs = segs.filter(s => s.a[1] === s.b[1]);
	const Vs = segs.filter(s => s.a[0] === s.b[0]);
	const rng = (s, ax) => [Math.min(s.a[ax], s.b[ax]), Math.max(s.a[ax], s.b[ax])];
	const checkColl = (arr, lineAx, rngAx) => {
		for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
			const s = arr[i], t = arr[j];
			if (s.a[lineAx] !== t.a[lineAx]) continue;            // 不同线坐标
			if (s.electrical === t.electrical) continue;           // 同一命名网或同一未命名 wire group
			const [s0, s1] = rng(s, rngAx), [t0, t1] = rng(t, rngAx);
			if (Math.max(s0, t0) < Math.min(s1, t1)) {            // 内部重叠（严格,端点相贴不算）
				collinear++; if (collEx.length < 8) collEx.push(`${s.net||s.electrical}|${t.net||t.electrical}@${lineAx === 1 ? 'y' : 'x'}=${s.a[lineAx]}`);
			}
		}
	};
	checkColl(Hs, 1, 0);   // 水平段:同 y(轴1)、比 x 范围(轴0)
	checkColl(Vs, 0, 1);   // 竖直段:同 x(轴0)、比 y 范围(轴1)

	// 6) 异网端点重合（两条异网线在同一点都有端点 = 该点把两网短在一起；crossings/collinear/wireThruPin 都排端点故漏）
	let endpointShort = 0; const endEx = [];
	const ptNet = new Map();   // "x,y" → Set(net)
	for (const s of segs) {
		for (const [px, py] of [s.a, s.b]) {
			const k = `${px},${py}`;
			if (!ptNet.has(k)) ptNet.set(k, new Set());
			ptNet.get(k).add(s.electrical);
		}
	}
	for (const [k, nets] of ptNet) {
		if (nets.size > 1) { endpointShort++; if (endEx.length < 8) endEx.push(`${[...nets].join('|')}@${k}`); }
	}

	// 7) 异网 T 接（一条线端点落在另一条异网线内部 = 该点短路；wireThruPin 的线-线类比，前述检测皆漏）
	let endpointOnWire = 0; const eowEx = [];
	for (const s of segs) {
		for (const [px, py] of [s.a, s.b]) {
			for (const t of segs) {
				if (t === s || t.electrical === s.electrical) continue;
				if (ptOnSegInterior(px, py, t)) { endpointOnWire++; if (eowEx.length < 8) eowEx.push(`${s.net||s.electrical}|${t.net||t.electrical}@${px},${py}`); }
			}
		}
	}

	/* rulebook 行 166:可见标注 bbox 被其他器件线段穿过 = hard(text over another wire)。
	 * "異網/other wire" 在此模型中以几何同器件排除实现:attr 和脚均无 net 字段,无法
	 * 按网名过滤,改为排除端点落在本器件任意脚坐标(容差≤2)上的线段 ——
	 * 这类段是连接本件自身的脚线,正常出现在标注附近,报出属于误报。
	 * 复用已建的 segs 集合与 segInRect 判定函数,不引入重复逻辑(DRY)。 */
	const textOnWire = [];
	for (const c of model.components || []) {
		for (const a of (c.attrs || [])) {
			if (!a.bbox || !(a.valueVisible || a.keyVisible)) continue;
			const cPins = c.pins || [];
			for (const s of segs) {
				if (!segInRect(s, a.bbox)) continue;
				/* 几何同器件排除:若线段任一端点与本件任意脚坐标重合(≤2 单位容差),
				 * 视为本器件自身脚线,不报;只有真正"外来"线才记录。 */
				const ownPin = cPins.some(p =>
					(Math.abs(s.a[0] - p.x) <= 2 && Math.abs(s.a[1] - p.y) <= 2) ||
					(Math.abs(s.b[0] - p.x) <= 2 && Math.abs(s.b[1] - p.y) <= 2)
				);
				if (ownPin) continue;
				textOnWire.push(`attr:${c.designator}.${a.key || '?'} x wire[${s.net || ''}]`);
				break;
			}
		}
	}

	for (const t of model.texts || []) if (t.bbox && segs.some(s => segInRect(s, t.bbox)))
		textOnWire.push(`text:${t.id || t.text} x wire`);
	return { overlaps, overlapDetails, wireThruComp, wireThruPin, offgrid, offEx, crossings, crossEx, collinear, collEx, endpointShort, endEx, endpointOnWire, eowEx, textOnWire };
}

if (process.argv[1] && process.argv[1].endsWith('geom_qc.mjs') && process.argv[2]) {
	const m = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
	const r = geomQC(m);
	console.log('=== GEOM QC:', process.argv[2], '===');
	console.log('bbox重叠:', r.overlaps.length); r.overlaps.slice(0, 20).forEach(s => console.log('  ', s));
	console.log('线压器件:', r.wireThruComp.length); r.wireThruComp.slice(0, 12).forEach(s => console.log('  ', s));
	console.log('出格脚:', r.offgrid, r.offEx.join(' '));
	console.log('异网交叉:', r.crossings, r.crossEx.join(' '));
}

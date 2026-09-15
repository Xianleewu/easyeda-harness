// 几何严标检查器(复用 geomQC,零特定电路内容,机械判)
import { TOKENS, tokenById } from './design_tokens.mjs';
import { geomQC } from './geom_qc.mjs';
import { netflagNameBox, flagBox } from './structured_layout.mjs';
import { pageQC } from './page_qc.mjs';
import { auditPassiveFootprints, passiveKind } from './passive_footprint_audit.mjs';

const res = (id, deviations, detail) => ({ token: id, conform: deviations.length === 0, deviations, detail });

// T-ORTHO: 每段必 dx==0||dy==0,否则记偏离(严标 100%,零斜段)
export function checkOrtho(model) {
	const dev = [];
	for (const [wireIndex, w] of (model.wires || []).entries()) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const dx = l[i + 2] - l[i];
			const dy = l[i + 3] - l[i + 1];
			if (dx !== 0 && dy !== 0) {
				dev.push({ kind: 'diagonal-seg', wire: w.id || `wire-${wireIndex}`, net: w.net || '', at: [l[i], l[i + 1], l[i + 2], l[i + 3]] });
			}
		}
	}
	return res('T-ORTHO', dev, { nonOrtho: dev.length });
}

// T-GRID: 脚坐标必落 grid 倍数(严标 100%,无脱格脚)
// 用"到最近格倍数距离 > eps"判脱格:容忍 EDA 回读的浮点 epsilon(如 1710.0000000000002 实为 1710),
// 但真脱格(如 1712)照判。非放水——脚确在格上才放过。
export function checkGrid(model) {
	const tok = tokenById('T-GRID');
	const g = tok ? tok.value.grid : 5;
	const eps = 1e-6;
	const offGrid = v => Math.abs(v - Math.round(v / g) * g) > eps;
	const dev = [];
	for (const c of model.components || []) {
		for (const p of c.pins || []) {
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
				continue;
			}
			if (offGrid(p.x) || offGrid(p.y)) {
				dev.push({ kind: 'off-grid-pin', designator: c.designator || c.id || '', pin: p.num || p.id || '', at: [p.x, p.y] });
			}
		}
	}
	return res('T-GRID', dev, { grid: g, offGrid: dev.length });
}

// 复用 geomQC 的计数(DR2/3/4/5),严标 max=0
function geomCounts(model) {
	const g = geomQC(model);
	return {
		cross: g.crossings || 0,
		shorts: (g.collinear || 0) + (g.endpointShort || 0) + (g.endpointOnWire || 0),
		thru: (g.wireThruComp || []).length + (g.wireThruPin || []).length,
		overlap: (g.overlaps || []).length,
		raw: g,
	};
}

// T-NOCROSS: 异网线不交叉不中段相接(严标 max=0)
export function checkNoCross(model) {
	const c = geomCounts(model);
	const dev = [];
	const crossingExamples = (c.raw.crossEx || []).slice(0, 8);
	const shortExamples = [
		...(c.raw.collEx || []),
		...(c.raw.endEx || []),
		...(c.raw.eowEx || []),
	].slice(0, 8);
	if (c.cross > 0) dev.push({ kind: 'crossing', n: c.cross, examples: crossingExamples });
	if (c.shorts > 0) dev.push({ kind: 'mid-segment-touch', n: c.shorts, examples: shortExamples });
	return res('T-NOCROSS', dev, {
		crossings: c.cross,
		shorts: c.shorts,
		crossingExamples,
		shortExamples,
	});
}

// T-NOTHRU: 线不穿件/脚(严标 max=0)
export function checkNoThru(model) {
	const c = geomCounts(model);
	const componentExamples = (c.raw.wireThruComp || []).slice(0, 8);
	const pinExamples = (c.raw.wireThruPin || []).slice(0, 8);
	return res('T-NOTHRU', c.thru ? [{
		kind: 'wire-through-object',
		n: c.thru,
		examples: [...componentExamples, ...pinExamples].slice(0, 8),
	}] : [], { thru: c.thru, componentExamples, pinExamples });
}

// T-NOTHRU-TEXT: 导线不得穿过【文字】内部(可见标注 / sig net标签 / 电源地符号网名)。
//   T-NOTHRU(geomCounts)只查穿件体/脚,对穿文字瞎(连 geomQC.textOnWire 都没计入 thru)。
//   *_MIDDLE 信号标签(文字纵向居中在导线上)= 导线穿文字中线 → 此 token 抓。
//   排除"自身连接线"(端点落在该文字所属器件的脚上,容差≤2)避免误报本件脚线;net标签/符号名按几何判
//   (正确侧标签向外展不被自桩穿;错侧/居中被穿 = 真缺陷,抓)。live 同等完整(classOfNet 推 kind、flagBox/netflagNameBox 兜底)。
export function checkWireThruText(model) {
	const segs = [];
	for (const w of (model.wires || [])) {
		const L = w.line || [];
		for (let i = 0; i + 3 < L.length; i += 2) {
			const a = [L[i], L[i + 1]], b = [L[i + 2], L[i + 3]];
			if (a[0] === b[0] && a[1] === b[1]) continue;
			segs.push({ a, b, net: w.net });
		}
	}
	const texts = [];
	for (const c of model.components || []) {
		const pins = (c.pins || []).map(p => [p.x, p.y]);
		for (const a of (c.attrs || [])) if (a.bbox && (a.valueVisible || a.keyVisible))
			texts.push({ tag: `attr:${c.designator}.${a.key || '?'}`, box: a.bbox, ownPins: pins });
	}
	for (const f of (model.netflags || [])) {
		const k = f.kind || classOfNet(f.net);
		if (k === 'sig') { if (f.bbox) texts.push({ tag: `label[${f.net}]`, box: f.bbox, ownPins: [] }); }
		else { const nb = netflagNameBox(f, k); if (nb) texts.push({ tag: `name[${f.net}]`, box: nb, ownPins: [] }); }
	}
	const ins = r => ({ minX: r.minX + 1, minY: r.minY + 1, maxX: r.maxX - 1, maxY: r.maxY - 1 });
	const thru = (s, r) => {                                  /* 轴向段穿矩形内部(端点贴边不算) */
		const ri = ins(r);
		if (s.a[0] === s.b[0]) { const x = s.a[0]; if (x <= ri.minX || x >= ri.maxX) return false; const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]); return y0 < ri.maxY && y1 > ri.minY; }
		if (s.a[1] === s.b[1]) { const y = s.a[1]; if (y <= ri.minY || y >= ri.maxY) return false; const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]); return x0 < ri.maxX && x1 > ri.minX; }
		return false;
	};
	const dev = [];
	for (const t of texts) for (const s of segs) {
		if (!thru(s, t.box)) continue;
		dev.push({
			kind: 'wire-through-text',
			text: t.tag,
			net: s.net || '',
			segment: [s.a[0], s.a[1], s.b[0], s.b[1]],
			textBox: { ...t.box },
		});
		break;
	}
	return res('T-NOTHRU-TEXT', dev, { thru: dev.length });
}

export function checkLabelCrowd(model) {
	const v=tokenById('T-LABEL-CROWD').value;
	const labels=(model.netflags||[]).filter(f=>(f.kind||classOfNet(f.net))==='sig'&&f.bbox&&
		[f.bbox.minX,f.bbox.minY,f.bbox.maxX,f.bbox.maxY].every(Number.isFinite));
	const X=f=>f.textX??f.x,Y=f=>f.textY??f.y;
	const overlap=(a,b)=>a.minX<b.maxX&&b.minX<a.maxX&&a.minY<b.maxY&&b.minY<a.maxY;
	const gap=(a,b)=>Math.hypot(Math.max(0,a.minX-b.maxX,b.minX-a.maxX),Math.max(0,a.minY-b.maxY,b.minY-a.maxY));
	const id=f=>f.wireId||`${f.net}@${X(f)},${Y(f)}`;
	const dev=[];
	for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
		const a=labels[i],b=labels[j];
		if(overlap(a.bbox,b.bbox))dev.push({kind:'label-text-overlap',a:id(a),b:id(b),aBox:{...a.bbox},bBox:{...b.bbox}});
		else if(a.alignMode===b.alignMode&&Math.abs(X(a)-X(b))<=v.xTol&&gap(a.bbox,b.bbox)<v.minTextGap)
			dev.push({kind:'label-text-gap',a:id(a),b:id(b),gap:+gap(a.bbox,b.bbox).toFixed(2),minGap:v.minTextGap});
	}
	for(const d of checkWireThruText(model).deviations.filter(d=>String(d.text||'').startsWith('label[')))
		dev.push({kind:'label-wire-through',label:d.text,net:d.net,segment:d.segment,textBox:d.textBox});
	return res('T-LABEL-CROWD',dev,{labels:labels.length,crowded:dev.length});
}

// T-TEXT-OVERLAP: 电源/地符号【网名文字】bbox 不与别的可见对象相交(别的符号名/字形/标注/net标签/器件体)。
//   geomQC.overlaps 只含器件体/字形/标注,【漏符号网名】→ 对文字瞎(用户实证 C9/R4 GND×VCC_3V3 名压却报 0)。
//   live readGeometry 的 netflag 无 f.kind → 按 classOfNet(net) 推后算 nameBox(live 与 model 同等完整、不判瞎)。
//   每条偏差至少一侧是符号网名(name[..]);名贴自身字形外缘=相切非相交,不自压。
export function checkTextOverlap(model) {
	const flags = model.netflags || [];
	const names = [];                                  /* 电源/地符号网名文字框 */
	for (const f of flags) { const nb = netflagNameBox(f, f.kind || classOfNet(f.net)); if (nb) names.push({ tag: `name[${f.net}]`, box: nb }); }
	const others = [];                                 /* 其它可见对象:器件体 + 可见标注 + 符号字形/net标签 */
	for (const c of model.components || []) {
		if (c.bbox) others.push({ tag: c.designator, box: c.bbox });
		for (const a of (c.attrs || [])) if (a.bbox && (a.valueVisible || a.keyVisible)) others.push({ tag: `attr:${c.designator}.${a.key || '?'}`, box: a.bbox });
	}
	for (const f of flags) {
		const k = f.kind || classOfNet(f.net);
		const tx = Number.isFinite(f.x) ? f.x : f.textX, ty = Number.isFinite(f.y) ? f.y : f.textY;
		/* 字形框:model 有 f.bbox;live readGeometry 可能无 → 按 flagBox 兜底算(电源/地),sig 仅在有 bbox 时纳入。 */
		const gb = f.bbox || (k !== 'sig' && Number.isFinite(tx) && Number.isFinite(ty) ? flagBox(k, tx, ty) : null);
		if (gb) others.push({ tag: k === 'sig' ? `label[${f.net}]` : `[${f.net}]`, box: gb });
	}
	const ins = r => ({ minX: r.minX + 1, minY: r.minY + 1, maxX: r.maxX - 1, maxY: r.maxY - 1 });
	const ov = (a, b) => { const x = ins(a), y = ins(b); return x.minX < y.maxX && y.minX < x.maxX && x.minY < y.maxY && y.minY < x.maxY; };
	const dev = [];
	for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
		if (ov(names[i].box, names[j].box)) dev.push({ kind: 'text-overlap', a: names[i].tag, b: names[j].tag });
	for (const n of names) for (const o of others) if (ov(n.box, o.box)) dev.push({ kind: 'text-overlap', a: n.tag, b: o.tag });
	return res('T-TEXT-OVERLAP', dev, { overlaps: dev.length });
}

// T-NOOVERLAP: 可见对象无重叠(严标 max=0)
export function checkNoOverlap(model) {
	const c = geomCounts(model);
	const examples = (c.raw.overlaps || []).slice(0, 8);
	const pairs=(c.raw.overlapDetails||[]).slice(0,8);
	return res('T-NOOVERLAP', c.overlap ? [{ kind: 'overlap', n: c.overlap, examples, pairs }] : [], { overlap: c.overlap, examples, pairs });
}

// 内部助手:计算包围框中心
function bboxCenter(c) {
	return c.bbox ? [(c.bbox.minX + c.bbox.maxX) / 2, (c.bbox.minY + c.bbox.maxY) / 2] : [c.x, c.y];
}

// 内部助手:求数组中位数
// floor-median,与 T-DENSITY 阈值的标定方法一致(勿改成均值,会解校准)
function median(a) {
	if (!a.length) {
		return 0;
	}
	const s = [...a].sort((x, y) => x - y);
	return s[Math.floor(s.length / 2)];
}

// T-DENSITY: 最近邻中心距中位 ≤ medMax 且 min ≥ minNN(治稀疏散布)
export function checkDensity(model) {
	const v = tokenById('T-DENSITY').value;
	const cs = (model.components || []).map(bboxCenter).filter(p => Number.isFinite(p[0]));
	const dists = [];
	for (let i = 0; i < cs.length; i++) {
		let m = Infinity;
		for (let j = 0; j < cs.length; j++) {
			if (i === j) {
				continue;
			}
			const d = Math.hypot(cs[i][0] - cs[j][0], cs[i][1] - cs[j][1]);
			if (d < m) {
				m = d;
			}
		}
		if (m < Infinity) {
			dists.push(m);
		}
	}
	const med = +median(dists).toFixed(0), mn = dists.length ? +Math.min(...dists).toFixed(0) : 0;
	const dev = [];
	if (dists.length && med > v.medMax) {
		dev.push({ kind: 'too-sparse', medNN: med, medMax: v.medMax });
	}
	if (dists.length && mn < v.minNN) {
		dev.push({ kind: 'too-crowded', minNN: mn });
	}
	return res('T-DENSITY', dev, { medNN: med, minNN: mn, n: dists.length });
}

function boxGap(a, b) {
	const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
	const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
	return Math.hypot(dx, dy);
}

// DR22: page-wide density cannot conceal one locally crowded pair.
export function checkBodyClearance(model, opts = {}) {
	const minGap = opts.minGap ?? tokenById('T-BODY-CLEARANCE').value.minGap;
	const except = new Set((opts.exceptions || model.placementExceptions || []).map(x =>
		Array.isArray(x) ? [...x].sort().join('|') : [x.a, x.b].sort().join('|')));
	const cs = (model.components || []).filter(c => c.bbox && c.designator);
	const dev = [];
	for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
		const key = [cs[i].designator, cs[j].designator].sort().join('|');
		if (except.has(key)) continue;
		const gap = boxGap(cs[i].bbox, cs[j].bbox);
		if (gap < minGap) dev.push({ kind: 'component-body-gap', a: cs[i].designator, b: cs[j].designator, gap: +gap.toFixed(1), minGap });
	}
	return res('T-BODY-CLEARANCE', dev, { minGap, violations: dev.length, components: cs.length });
}

// DR19: use declared page geometry instead of inferring free space from a crop.
// Offline geometry unit tests may omit page evidence; live acceptance always
// sets requireEvidence and therefore fails closed when either boundary is absent.
export function checkPage(model, opts = {}) {
	const sheetBounds = opts.sheetBounds || model.sheetBounds || model.sheet || null;
	const titleBlock = opts.titleBlockKeepout || opts.titleBlock || model.titleBlockKeepout || model._titleBlock || null;
	if (!opts.requireEvidence && (!sheetBounds || !titleBlock))
		return res('T-PAGE', [], { skipped: true, reason: 'page evidence not requested' });
	const token = tokenById('T-PAGE').value;
	const report = pageQC(model, { sheetBounds, titleBlock, moduleRegions: opts.moduleRegions || model.moduleRegions || [],
		clearance: opts.clearance ?? token.clearance, balance: opts.balance || token.balance });
	return res('T-PAGE', report.findings.map(({ rule, ...f }) => f), {
		sheetBounds, titleBlock, clearance: opts.clearance ?? token.clearance,
		findings: report.findings.length, balance: report.detail?.balance || null,
	});
}

// DR21: module content boxes carry the spacing measurement; allocated boxes
// carry inner-padding evidence. Missing module evidence is itself a deviation
// for a non-trivial sheet so the gate cannot silently judge blind.
export function checkModuleSpacing(model, opts = {}) {
	const v = tokenById('T-MODULE-SPACING').value;
	const regions = opts.moduleRegions || model.moduleRegions || [];
	const dev = [];
	if (!regions.length) {
		if ((model.components || []).length >= 4) dev.push({ kind: 'module-regions-missing' });
		return res('T-MODULE-SPACING', dev, { regions: 0, minGap: v.minGap, maxNearestGap: v.maxNearestGap, minInnerPadding: v.minInnerPadding });
	}
	const boxes = regions.map(r => ({ name: r.name || r.module || r.id || '?', box: r.box, content: r.contentBox || r.actualBox || r.box, corridor: r.externalInterfaceCorridor === true }));
	for (const r of boxes) {
		if (!r.box || !r.content) { dev.push({ kind: 'module-box-missing', module: r.name }); continue; }
		const pad = {
			left: r.content.minX - r.box.minX, top: r.content.minY - r.box.minY,
			right: r.box.maxX - r.content.maxX, bottom: r.box.maxY - r.content.maxY,
		};
		const smallest = Math.min(pad.left, pad.top, pad.right, pad.bottom);
		if (smallest < v.minInnerPadding) dev.push({ kind: 'module-inner-padding', module: r.name, padding: +smallest.toFixed(1), minInnerPadding: v.minInnerPadding });
	}
	for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
		if (!boxes[i].content || !boxes[j].content) continue;
		const gap = boxGap(boxes[i].content, boxes[j].content);
		if (gap < v.minGap) dev.push({ kind: 'module-gap', a: boxes[i].name, b: boxes[j].name, gap: +gap.toFixed(1), minGap: v.minGap });
	}
	if (boxes.length > 1) for (let i = 0; i < boxes.length; i++) {
		if (boxes[i].corridor || !boxes[i].content) continue;
		let nearest = Infinity, peer = '';
		for (let j = 0; j < boxes.length; j++) if (i !== j && boxes[j].content) {
			const gap = boxGap(boxes[i].content, boxes[j].content);
			if (gap < nearest) { nearest = gap; peer = boxes[j].name; }
		}
		if (nearest > v.maxNearestGap) dev.push({ kind: 'module-isolated', module: boxes[i].name, peer, gap: +nearest.toFixed(1), maxNearestGap: v.maxNearestGap });
	}
	return res('T-MODULE-SPACING', dev, { regions: boxes.length, minGap: v.minGap, maxNearestGap: v.maxNearestGap, minInnerPadding: v.minInnerPadding });
}

// DR26: module-level spacing cannot hide crowded interface/protection/driver/output cells.
// Every cell declares direct peers by stable role/id. Undeclared pairs are unrelated and
// receive the larger gap. A compact exception is explicit and local, never inferred from space.
export function checkCellSpacing(model, opts = {}) {
	const v = tokenById('T-CELL-SPACING').value;
	const cells = opts.cellRegions || model.cellRegions || [];
	const dev = [];
	if (!cells.length) {
		if ((model.components || []).length >= 4) dev.push({ kind: 'cell-regions-missing' });
		return res('T-CELL-SPACING', dev, { cells: 0, ...v });
	}
	const rows = cells.map(c => ({ id: c.id || c.name || c.role || '?', module: c.module || '', box: c.box, content: c.contentBox || c.actualBox || c.box,
		related: new Set(c.relatedTo || []), compact: new Set(c.compactWith || []) }));
	for (const c of rows) {
		if (!c.module) dev.push({ kind: 'cell-module-missing', cell: c.id });
		if (!c.box || !c.content) { dev.push({ kind: 'cell-box-missing', cell: c.id }); continue; }
		const pad = Math.min(c.content.minX-c.box.minX,c.content.minY-c.box.minY,c.box.maxX-c.content.maxX,c.box.maxY-c.content.maxY);
		if (pad < v.minInnerPadding) dev.push({ kind: 'cell-inner-padding', cell: c.id, padding:+pad.toFixed(1), minInnerPadding:v.minInnerPadding });
	}
	for (let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) {
		const a=rows[i],b=rows[j]; if(!a.content||!b.content)continue;
		if(a.module&&b.module&&a.module!==b.module)continue;
		const overlapX=Math.min(a.content.maxX,b.content.maxX)-Math.max(a.content.minX,b.content.minX);
		const overlapY=Math.min(a.content.maxY,b.content.maxY)-Math.max(a.content.minY,b.content.minY);
		if(overlapX>0&&overlapY>0){
			dev.push({kind:'cell-overlap',a:a.id,b:b.id,overlapX:+overlapX.toFixed(1),overlapY:+overlapY.toFixed(1)});
			continue;
		}
		if(a.compact.has(b.id)||b.compact.has(a.id))continue;
		const related=a.related.has(b.id)||b.related.has(a.id);
		const need=related?v.minGap:v.unrelatedGap, gap=boxGap(a.content,b.content);
		if(gap<need)dev.push({kind:'cell-gap',a:a.id,b:b.id,related,gap:+gap.toFixed(1),minGap:need});
	}
	return res('T-CELL-SPACING',dev,{cells:rows.length,...v});
}

// DR24: infer connector mounting metal from semantic pin names or pins beyond
// the declared contact count. The rule is role-based and circuit-agnostic.
export function checkConnectorMountingPins(model, opts = {}) {
	const nets = opts.nets;
	const exceptions = new Set(opts.exceptions || model.connectorMountExceptions || []);
	const dev = [], candidates = [];
	const declaredCount = c => {
		const attrs = c.attrs || [];
		for (const key of ['Number of Pins','Pins Structure','Number of Contacts']) {
			const a=attrs.find(x=>x.key===key), nums=String(a?.value||'').match(/\d+/g)?.map(Number).filter(Number.isFinite)||[];
			if (!nums.length) continue;
			if (key==='Pins Structure'&&nums.length>=2) return nums.reduce((p,n)=>p*n,1);
			return nums.at(-1);
		}
		return null;
	};
	for (const c of model.components || []) {
		if (!/^(J|P|CN|CON)\d/i.test(c.designator || '')) continue;
		const n=declaredCount(c);
		for(const p of c.pins||[]){
			const num=Number(p.num), semantic=/^(EH|SHIELD|SHELL|MH|MP|MOUNT)/i.test(String(p.name||''));
			if(!semantic&&!(Number.isFinite(num)&&Number.isFinite(n)&&num>n))continue;
			candidates.push({c,p});
		}
	}
	if(candidates.length&&!nets)dev.push({kind:'connector-mount-netlist-missing',n:candidates.length});
	for(const {c,p} of candidates){
		const key=`${c.designator}.${p.num}`;if(exceptions.has(key))continue;
		const direct=(model.netflags||[]).filter(f=>Math.abs((f.x??f.textX)-p.x)<1e-6&&Math.abs((f.y??f.textY)-p.y)<1e-6);
		if(direct.length)dev.push({kind:'connector-mount-flag-direct-pin-overlap',pin:key,flags:direct.map(f=>f.id||f.net||'?')});
		const net=nets?.[c.designator]?.[p.num]||'';
		if(classOfNet(net)!=='ground')dev.push({kind:'connector-mount-not-grounded',pin:key,net});
	}
	// A row of conductive tabs on one connector side is one mechanical shield
	// cell. It must read as one bus with one ground symbol, rather than a comb of
	// repeated flags. Use drawable geometry; equal net names alone do not prove
	// the required shared local bus.
	const wires=model.wires||[],flags=model.netflags||[];
	if(wires.length&&flags.length){
		const segs=wires.map((w,wi)=>{const out=[];for(let i=0;i+3<(w.line||[]).length;i+=2)out.push({wi,a:[w.line[i],w.line[i+1]],b:[w.line[i+2],w.line[i+3]]});return out;}).flat();
		const par=wires.map((_,i)=>i),find=i=>{while(par[i]!==i){par[i]=par[par[i]];i=par[i];}return i;},uni=(a,b)=>{a=find(a);b=find(b);if(a!==b)par[b]=a;};
		const on=(p,s)=>s.a[1]===s.b[1]?Math.abs(p[1]-s.a[1])<1e-7&&p[0]>=Math.min(s.a[0],s.b[0])-1e-7&&p[0]<=Math.max(s.a[0],s.b[0])+1e-7:s.a[0]===s.b[0]&&Math.abs(p[0]-s.a[0])<1e-7&&p[1]>=Math.min(s.a[1],s.b[1])-1e-7&&p[1]<=Math.max(s.a[1],s.b[1])+1e-7;
		const cross=(s,t)=>[s.a,s.b].some(p=>on(p,t))||[t.a,t.b].some(p=>on(p,s));
		for(let i=0;i<segs.length;i++)for(let j=i+1;j<segs.length;j++)if(cross(segs[i],segs[j]))uni(segs[i].wi,segs[j].wi);
		const rootsAt=p=>[...new Set(segs.filter(s=>on(p,s)).map(s=>find(s.wi)))];
		const sideOf=(c,p)=>{const pr=p.rotation??p.rot;if(pr!==null&&pr!==undefined&&Number.isFinite(Number(pr))){const r=((Number(pr)%360)+360)%360;if(r===0)return'right';if(r===180)return'left';if(r===90)return'bottom';if(r===270)return'top';}if(!c.bbox)return'?';const cx=(c.bbox.minX+c.bbox.maxX)/2,cy=(c.bbox.minY+c.bbox.maxY)/2;return Math.abs(p.x-cx)>=Math.abs(p.y-cy)?(p.x>=cx?'right':'left'):(p.y>=cy?'bottom':'top');};
		const groups=new Map();for(const item of candidates){if(!Number.isFinite(item.p.x)||!Number.isFinite(item.p.y))continue;const k=`${item.c.designator}:${sideOf(item.c,item.p)}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(item);}
		for(const [group,items] of groups){if(items.length<2)continue;const side=group.split(':').at(-1),pinRoots=items.map(({p})=>rootsAt([p.x,p.y])),flat=[...new Set(pinRoots.flat())];
			if(pinRoots.some(x=>x.length!==1)||flat.length!==1){dev.push({kind:'connector-mount-ground-not-shared',component:items[0].c.designator,side,pins:items.map(x=>x.p.num),wireRoots:flat.length});continue;}
			const root=flat[0],groundFlags=flags.filter(f=>classOfNet(f.net)==='ground'&&Number.isFinite(f.x??f.textX)&&rootsAt([f.x??f.textX,f.y??f.textY]).includes(root));
			if(groundFlags.length!==1){dev.push({kind:'connector-mount-ground-flag-count',component:items[0].c.designator,side,pins:items.map(x=>x.p.num),flags:groundFlags.map(f=>f.id||f.net||'?'),got:groundFlags.length,expect:1});continue;}
			if(side==='left'||side==='right'){
				const f=groundFlags[0],fy=f.y??f.textY,minY=Math.min(...items.map(x=>x.p.y));
				const rotation=Number.isFinite(f.rotation)?((f.rotation%360)+360)%360:null;
				// Live EasyEDA coordinates put a visually downward Ground flag below
				// a vertical side group at the smaller Y side, with rotation 0.
				if(fy>=minY||rotation!==null&&rotation!==0)dev.push({kind:'connector-mount-ground-not-downward',component:items[0].c.designator,side,flag:f.id||f.net||'?',at:[f.x??f.textX,fy],rotation});
			}
		}
	}
	return res('T-CONN-MOUNT',dev,{candidates:candidates.length,exceptions:exceptions.size});
}

// Connectivity alone cannot prove a connector's endpoint/root-side convention
// or its symbol-to-footprint numbering. Circuit-specific truth stays in a
// private evidence manifest; this checker only implements generic comparison.
function semanticValueMatches(actual, expected) {
	const list = Array.isArray(expected) ? expected : [expected];
	return list.some(candidate => {
		if (typeof candidate !== 'string') return false;
		const m = candidate.match(/^\/(.*)\/([dgimsuvy]*)$/);
		if (m) { try { return new RegExp(m[1], m[2]).test(String(actual ?? '')); } catch { return false; } }
		return String(actual ?? '') === candidate;
	});
}

function footprintPadNumbers(source) {
	const pads=[];
	for(const raw of String(source||'').split('\n')){
		const i=raw.indexOf('||');if(i<0)continue;
		try{const h=JSON.parse(raw.slice(0,i)),a=JSON.parse(raw.slice(i+2).replace(/\|$/,''));if(h.type==='PAD')pads.push(String(a.num??''));}catch{}
	}
	return pads;
}

function footprintDocumentUuids(source) {
	const uuids=[];
	for(const raw of String(source||'').split('\n')){
		const i=raw.indexOf('||');if(i<0)continue;
		try{const h=JSON.parse(raw.slice(0,i)),a=JSON.parse(raw.slice(i+2).replace(/\|$/,''));if(h.type==='DOCHEAD'&&a.docType==='FOOTPRINT'&&a.uuid)uuids.push(String(a.uuid));}catch{}
	}
	return [...new Set(uuids)];
}

function componentAttribute(component,key){
	return String((component?.attrs||[]).find(a=>a?.key===key)?.value??'');
}

export function checkConnectorPinSemantics(model, { nets, profiles, footprintProfiles, requireEvidence = false, requireLiveFootprintEvidence = false } = {}) {
	const components = (model.components || []).filter(c => /^(J|P|CN|CON)\d/i.test(String(c.designator || '')));
	const declared = Array.isArray(profiles) ? profiles : [];
	const byRef = new Map(declared.map(p => [String(p?.ref || ''), p]));
	const footprints = new Map((Array.isArray(footprintProfiles)?footprintProfiles:[]).map(p=>[String(p?.ref||''),p]));
	const dev = [];
	if (!components.length) return res('T-PIN-SEMANTICS', [], { connectors: 0, profiles: declared.length, checkedPins: 0 });
	if (!nets) dev.push({ kind: 'connector-semantic-netlist-missing', connectors: components.map(c => c.designator) });
	if (requireEvidence && !declared.length) dev.push({ kind: 'connector-semantic-profiles-missing', connectors: components.map(c => c.designator) });
	let checkedPins = 0;
	for (const c of components) {
		const ref = String(c.designator || '');
		const profile = byRef.get(ref);
		const footprint=footprints.get(ref);
		if(requireEvidence&&!footprint)dev.push({kind:'connector-footprint-profile-missing',designator:ref});
		else if(footprint){
			const liveUnavailable=requireLiveFootprintEvidence&&footprint.liveSourceVerified!==true;
			if(liveUnavailable)
				dev.push({kind:'connector-footprint-live-source-unverified',designator:ref,footprintUuid:footprint.footprintUuid||'',error:footprint.liveSourceError||''});
			if(requireLiveFootprintEvidence&&footprint.libraryUuid&&footprint.liveSourceVerified===true&&footprint.liveSourceLibraryUuid!==footprint.libraryUuid)
				dev.push({kind:'connector-footprint-library-mismatch',designator:ref,got:footprint.liveSourceLibraryUuid||'',expect:footprint.libraryUuid});
			const expectedUuid=String(footprint.footprintUuid||'');
			const placedUuid=componentAttribute(c,'Footprint');
			if(expectedUuid&&placedUuid!==expectedUuid)dev.push({kind:'connector-footprint-binding-mismatch',designator:ref,got:placedUuid,expect:expectedUuid});
			if(!liveUnavailable){
				const pads=footprintPadNumbers(footprint.sourceText),allowed=new Set((footprint.allowedExtraPads||[]).map(String));
				const sourceUuids=footprintDocumentUuids(footprint.sourceText);
				if(expectedUuid&&(sourceUuids.length!==1||sourceUuids[0]!==expectedUuid))dev.push({kind:'connector-footprint-source-uuid-mismatch',designator:ref,got:sourceUuids,expect:expectedUuid});
				if(!pads.length)dev.push({kind:'connector-footprint-pads-missing',designator:ref,footprintUuid:footprint.footprintUuid||''});
				else{
					if(Number.isFinite(Number(footprint.expectedPadCount))&&pads.length!==Number(footprint.expectedPadCount))
						dev.push({kind:'connector-footprint-pad-count',designator:ref,got:pads.length,expect:Number(footprint.expectedPadCount)});
					const counts=new Map();for(const pad of pads)counts.set(pad,(counts.get(pad)||0)+1);
					const allowedDuplicates=new Set((footprint.allowedDuplicatePads||[]).map(String));
					for(const [pad,count] of counts)if(count>1&&!allowedDuplicates.has(pad))dev.push({kind:'connector-footprint-pad-number-duplicate',designator:ref,pad,count});
					const padSet=new Set(pads),mapped=new Set();
					for(const pin of c.pins||[]){const pad=String(footprint.pinToPad?.[String(pin.num)]??pin.num);mapped.add(pad);if(!padSet.has(pad))dev.push({kind:'connector-footprint-pin-unmapped',designator:ref,pin:String(pin.num),pad});}
					for(const pad of padSet)if(!mapped.has(pad)&&!allowed.has(pad))dev.push({kind:'connector-footprint-pad-unmapped',designator:ref,pad});
				}
			}
		}
		if (!profile) {
			if (requireEvidence) dev.push({ kind: 'connector-semantic-profile-missing', designator: ref });
			continue;
		}
		if (!String(profile.source || '').trim()) dev.push({ kind: 'connector-semantic-source-missing', designator: ref });
		const specs = profile.pins && typeof profile.pins === 'object' ? profile.pins : {};
		const livePins = new Map((c.pins || []).map(p => [String(p.num), p]));
		for (const number of livePins.keys()) if (!Object.hasOwn(specs, number))
			dev.push({ kind: 'connector-semantic-pin-uncovered', designator: ref, pin: number });
		for (const [number, spec] of Object.entries(specs)) {
			const pin = livePins.get(String(number));
			if (!pin) { dev.push({ kind: 'connector-semantic-pin-missing', designator: ref, pin: number }); continue; }
			checkedPins++;
			if (requireEvidence && !String(spec?.sourceSignal || '').trim())
				dev.push({ kind: 'connector-source-signal-missing', designator: ref, pin: number, symbolName: pin.name || '' });
			const net = String(nets?.[ref]?.[number] ?? '');
			if (spec?.symbolNames !== undefined && !semanticValueMatches(pin.name, spec.symbolNames))
				dev.push({ kind: 'connector-symbol-name-mismatch', designator: ref, pin: number, got: pin.name || '', expect: spec.symbolNames, semantic: spec.semantic || '' });
			if (spec?.nets !== undefined && !semanticValueMatches(net, spec.nets))
				dev.push({ kind: 'connector-net-mismatch', designator: ref, pin: number, got: net, expect: spec.nets, semantic: spec.semantic || '' });
			if (spec?.state === 'connected' && (!net || pin.noConnected === true))
				dev.push({ kind: 'connector-pin-expected-connected', designator: ref, pin: number, net, noConnected: pin.noConnected === true });
			if (spec?.state === 'nc' && (net || pin.noConnected !== true))
				dev.push({ kind: 'connector-pin-expected-nc', designator: ref, pin: number, net, noConnected: pin.noConnected === true });
		}
	}
	for (const ref of byRef.keys()) if (!components.some(c => String(c.designator || '') === ref))
		dev.push({ kind: 'connector-semantic-component-missing', designator: ref });
	return res('T-PIN-SEMANTICS', dev, { connectors: components.length, profiles: declared.length, footprintProfiles:footprints.size, checkedPins });
}

const endpointKey = e => `${e.ref}.${e.pin}`;
const sortedUnique = xs => [...new Set(xs)].sort();

function sourceSignalPolarity(value) {
	const s=String(value||'').trim();
	if(/(?:\+|_P|p\d*)$/i.test(s))return'positive';
	if(/(?:-|_N|n\d*)$/i.test(s))return'negative';
	return null;
}

export function checkHighSpeedIntent(model, { nets, profiles, connectorProfiles, requireEvidence = false } = {}) {
	const declared = Array.isArray(profiles) ? profiles : [];
	const connectorPins=new Map();
	for(const profile of Array.isArray(connectorProfiles)?connectorProfiles:[])
		for(const [pin,spec] of Object.entries(profile?.pins||{}))connectorPins.set(`${profile.ref}.${pin}`,spec);
	const dev = [];
	if (!nets) return res('T-HIGHSPEED', requireEvidence ? [{ kind:'highspeed-netlist-missing' }] : [], { inferredPairs:0, declaredPairs:0 });
	const actual = new Map();
	for (const [ref, pins] of Object.entries(nets || {})) for (const [pin, net] of Object.entries(pins || {})) {
		const name=String(net||''); if(!name)continue;
		if(!actual.has(name))actual.set(name,[]);actual.get(name).push({ref,pin:String(pin)});
	}
	const inferred=[];
	for(const name of actual.keys()){
		let negative=null;
		if(/_P$/i.test(name))negative=name.replace(/_P$/i,m=>m[0]==='p'?'_n':'_N');
		else if(/\+$/.test(name))negative=name.slice(0,-1)+'-';
		if(negative&&actual.has(negative))inferred.push({positive:name,negative});
	}
	const pairs=declared.flatMap(profile=>(profile?.pairs||[]).map(pair=>({profile,pair})));
	if(requireEvidence&&inferred.length&&!declared.length)dev.push({kind:'highspeed-profile-missing',pairs:inferred.map(p=>`${p.positive}/${p.negative}`)});
	const seen=new Set();
	for(const {profile,pair} of pairs){
		const id=String(pair?.id||`${pair?.positive||''}/${pair?.negative||''}`);
		if(!String(profile?.source||'').trim())dev.push({kind:'highspeed-source-missing',id});
		if(!String(profile?.protocol||'').trim())dev.push({kind:'highspeed-protocol-missing',id});
		if(!(Number(profile?.impedanceOhm)>0))dev.push({kind:'highspeed-impedance-missing',id});
		if(!(Number(profile?.maxIntraPairSkewMil)>=0))dev.push({kind:'highspeed-skew-missing',id});
		const positive=String(pair?.positive||''),negative=String(pair?.negative||'');
		if(!positive||!negative){dev.push({kind:'highspeed-pair-name-missing',id});continue;}
		const key=`${positive}\0${negative}`;if(seen.has(key))dev.push({kind:'highspeed-pair-duplicate',id,positive,negative});seen.add(key);
		if(!actual.has(positive))dev.push({kind:'highspeed-net-missing',id,net:positive,polarity:'positive'});
		if(!actual.has(negative))dev.push({kind:'highspeed-net-missing',id,net:negative,polarity:'negative'});
		for(const [polarity,net] of [['positive',positive],['negative',negative]]){
			const expected=Array.isArray(pair?.endpoints?.[polarity])?pair.endpoints[polarity]:[];
			if(!expected.length){dev.push({kind:'highspeed-endpoints-missing',id,net,polarity});continue;}
			for(const endpoint of expected)if(connectorPins.size){
				const key=endpointKey(endpoint),spec=connectorPins.get(key),sourceSignal=String(spec?.sourceSignal||'').trim();
				if(!spec||!sourceSignal)dev.push({kind:'highspeed-endpoint-source-semantic-missing',id,net,polarity,endpoint:key});
				else if(sourceSignalPolarity(sourceSignal)!==polarity)dev.push({kind:'highspeed-endpoint-source-polarity-mismatch',id,net,polarity,endpoint:key,sourceSignal});
			}
			const got=sortedUnique((actual.get(net)||[]).map(endpointKey)),want=sortedUnique(expected.map(endpointKey));
			if(got.join('\0')!==want.join('\0'))dev.push({kind:'highspeed-endpoints-mismatch',id,net,polarity,got,expect:want});
		}
	}
	for(const pair of inferred)if(!seen.has(`${pair.positive}\0${pair.negative}`))
		dev.push({kind:'highspeed-pair-uncovered',positive:pair.positive,negative:pair.negative});
	return res('T-HIGHSPEED',dev,{inferredPairs:inferred.length,declaredPairs:pairs.length,profiles:declared.length});
}

// T-ANNOT-PLACE: 2脚件标号+阻值在件外、同侧(≥sameSideMinPct)
export function checkAnnotPlace(model) {
	const v = tokenById('T-ANNOT-PLACE').value;
	const FAR = v.maxGap ?? 24, SEP = v.maxSep ?? 24;
	/* 两 bbox 最近边间隙(0=相交/相邻):用于"标注离器件过远"/"位号值分离"检测(用户:标注瞎放离器件远) */
	const gapBox = (a, b) => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));
	let total = 0, outside = 0, pair = 0, same = 0;
	const far = [], sep = [];
	for (const c of model.components || []) {
		const pins = c.pins || [];
		if (pins.length !== 2 || !c.bbox) {
			continue;
		}
		const bb = c.bbox, bcx = (bb.minX + bb.maxX) / 2, bcy = (bb.minY + bb.maxY) / 2;
		const horiz = Math.abs((pins[0].x ?? 0) - (pins[1].x ?? 0)) >= Math.abs((pins[0].y ?? 0) - (pins[1].y ?? 0));
		const labs = (c.attrs || []).filter(a => (a.key === 'Designator' || a.key === 'Name') && a.valueVisible && Number.isFinite(a.x));
		const perp = a => horiz ? a.y - bcy : a.x - bcx;
		const inside = a => a.x >= bb.minX && a.x <= bb.maxX && a.y >= bb.minY && a.y <= bb.maxY;
		const d = labs.find(a => a.key === 'Designator'), n = labs.find(a => a.key === 'Name');
		const isPassive = /^[RCL]\d/.test(c.designator || '');
		for (const a of labs) {
			total++;
			if (!inside(a)) {
				outside++;
			}
			/* 无源件标注须【紧贴器件体】(bbox 间隙 ≤ FAR);离器件过远=看不出谁是谁(用户怒点) */
			if (isPassive && a.bbox && gapBox(a.bbox, bb) > FAR) far.push(`${c.designator}.${a.key}`);
		}
		if (d && n) {
			pair++;
			if (Math.sign(perp(d)) === Math.sign(perp(n)) && perp(d) !== 0 && perp(n) !== 0) {
				same++;
			}
			/* 位号与值须【紧挨叠放】(两 bbox 间隙 ≤ SEP);分离太远=没章法 */
			if (isPassive && d.bbox && n.bbox && gapBox(d.bbox, n.bbox) > SEP) sep.push(c.designator);
		}
	}
	const outsidePct = total ? +(outside / total * 100).toFixed(0) : 100;
	const sameSidePct = pair ? +(same / pair * 100).toFixed(0) : 100;
	const dev = [];
	if (outsidePct < v.outsidePct) {
		dev.push({ kind: 'label-inside-body', outsidePct });
	}
	if (sameSidePct < v.sameSideMinPct) {
		dev.push({ kind: 'designator-value-not-same-side', sameSidePct });
	}
	if (far.length) dev.push({ kind: 'annot-too-far', n: far.length, sample: far.slice(0, 5) });
	if (sep.length) dev.push({ kind: 'designator-value-separated', n: sep.length, sample: sep.slice(0, 5) });
	return res('T-ANNOT-PLACE', dev, { outsidePct, sameSidePct, far: far.length, sep: sep.length, n: total });
}

export function checkAnnotSide(model) {
	const rendered=a=>a?.valueVisible&&a.bbox&&a.bbox.maxX>a.bbox.minX&&a.bbox.maxY>a.bbox.minY;
	const sides=(box,body)=>{
		const out=[];
		if(box.maxX<=body.minX)out.push('left');if(box.minX>=body.maxX)out.push('right');
		if(box.maxY<=body.minY)out.push('above');if(box.minY>=body.maxY)out.push('below');
		if(out.length)return out;
		const x=(box.minX+box.maxX)/2,y=(box.minY+box.maxY)/2;
		const cx=(body.minX+body.maxX)/2,cy=(body.minY+body.maxY)/2;
		const nx=(x-cx)/Math.max(1,body.maxX-body.minX),ny=(y-cy)/Math.max(1,body.maxY-body.minY);
		return [Math.abs(nx)>Math.abs(ny)?(nx<0?'left':'right'):(ny<0?'above':'below')];
	};
	const dev=[];let checked=0;
	for(const c of model.components||[]){
		if(!c.designator||!c.bbox)continue;
		const attrs=c.attrs||[],designator=attrs.find(a=>a.key==='Designator'&&rendered(a));
		const value=attrs.find(a=>a.key==='Name'&&rendered(a))||attrs.find(a=>a.key==='Value'&&rendered(a))||
			attrs.find(a=>a.key!=='Designator'&&rendered(a)&&String(a.value||'').trim());
		if(!designator||!value)continue;
		checked++;const designatorSides=sides(designator.bbox,c.bbox),valueSides=sides(value.bbox,c.bbox);
		if(!designatorSides.some(s=>valueSides.includes(s)))dev.push({kind:'annotation-side-mismatch',designator:c.designator,
			designatorSides,valueSides,designatorBox:{...designator.bbox},valueBox:{...value.bbox}});
	}
	return res('T-ANNOT-SIDE',dev,{checked,mismatched:dev.length,pct:checked?+((checked-dev.length)/checked*100).toFixed(0):100});
}

export function checkRegionCoverage(model,{moduleRegions,cellRegions,requireEvidence=false}={}){
	const refs=(model.components||[]).map(c=>String(c.designator||'')).filter(Boolean);
	const dev=[];
	const inspect=(kind,regions)=>{
		if(!Array.isArray(regions)||!regions.length){if(requireEvidence)dev.push({kind:'missing-region-evidence',regionKind:kind});return;}
		const count=new Map(),known=new Set(refs);
		for(const region of regions)for(const ref of region.members||[])count.set(String(ref),(count.get(String(ref))||0)+1);
		for(const ref of refs){const n=count.get(ref)||0;if(n===0)dev.push({kind:'orphan-component',regionKind:kind,designator:ref});
			else if(n>1)dev.push({kind:'multiple-region-membership',regionKind:kind,designator:ref,count:n});}
		for(const ref of count.keys())if(ref&&!known.has(ref))dev.push({kind:'unknown-region-member',regionKind:kind,designator:ref});
	};
	inspect('module',moduleRegions);inspect('cell',cellRegions);
	return res('T-ORPHAN',dev,{components:refs.length,findings:dev.length});
}

// T-ANNOT-FULL: 每个带位号的装配器件须同时显示位号和【人读值/型号】。
//   R/C/L 要求短数值(100nF/4.7kΩ/0Ω/100uH);其它器件要求非空型号/接口类型。
//   可接受绑定表达式(如 ={Value})，前提是其引用属性有人读内容且 live bbox 证明实际渲染。
export function checkAnnotFull(model) {
	const v = tokenById('T-ANNOT-FULL').value;
	const parts = (model.components || []).filter(c => !!c.designator);
	const rendered = a => a?.valueVisible && a.bbox?.maxX > a.bbox?.minX && a.bbox?.maxY > a.bbox?.minY;
	const passiveValue = s => { const t = String(s || '').trim(); return t.length > 0 && t.length <= 16 && !t.includes('{') && /\d/.test(t); };
	const partValue = s => { const t = String(s || '').trim(); return t.length > 0 && t.length <= 64 && !t.includes('{') && !/^C\d{5,}$/i.test(t); };
	const missingDesignator = [], missingValue = [];
	for (const c of parts) {
		const attrs = c.attrs || [], isPassive = /^[RCL]\d/i.test(c.designator);
		if (!attrs.some(a => a.key === 'Designator' && rendered(a) && String(a.value || '').trim() === c.designator)) missingDesignator.push(c.designator);
		const human = isPassive ? passiveValue : partValue;
		const hasValue = attrs.some(a => {
			if (a.key === 'Designator' || !rendered(a)) return false;
			if (human(a.value)) return true;
			const ref = /^=\{([^{}]+)\}$/.exec(String(a.value || ''));
			return !!ref && ref[1] !== 'Designator' && human(attrs.find(other => other.key === ref[1])?.value);
		});
		if (!hasValue) missingValue.push(c.designator);
	}
	const complete = parts.length - new Set([...missingDesignator, ...missingValue]).size;
	const pct = parts.length ? +(complete / parts.length * 100).toFixed(0) : 100;
	const dev = [];
	if (missingDesignator.length) dev.push({ kind: 'parts-missing-visible-designator', n: missingDesignator.length, sample: missingDesignator.slice(0, 8) });
	if (missingValue.length) dev.push({ kind: 'parts-missing-human-value-or-model', n: missingValue.length, sample: missingValue.slice(0, 8) });
	if (pct < v.minPct && !dev.length) dev.push({ kind: 'annotation-completeness', pct, need: v.minPct });
	return res('T-ANNOT-FULL', dev, { pct, parts: parts.length, complete, missingDesignator: missingDesignator.length, missingValue: missingValue.length });
}

// T-LABEL-ALIGN:锚点侧别必须由水平自由端导线方向决定，不能由标签自身 alignMode 反推。
// DR11:左侧=LEFT_BOTTOM/mode6，文字向右朝电路展开；DR12:右侧=RIGHT_BOTTOM/mode8，文字向左朝电路展开。
export function checkLabelAlign(model) {
	const v = tokenById('T-LABEL-ALIGN').value;
	const labs = (model.netflags || []).filter(f => f.kind === 'sig');
	const dev = [], geometrySide = new Map();
	const X = f => f.textX ?? f.x, Y = f => f.textY ?? f.y;
	const groupOf = id => String(id || '').replace(/#\d*$/, '');
	const segs = [];
	for (const w of (model.wires || [])) {
		const L = w.line || [];
		for (let i = 0; i + 3 < L.length; i += 2)
			segs.push({ line:[L[i], L[i + 1], L[i + 2], L[i + 3]], net:w.net || '', group:groupOf(w.id) });
	}
	const near = (a,b,t=1) => Math.abs(a-b)<=t;
	const endpoint = (f,s) => {
		const l=s.line,x=X(f),y=Y(f);
		if(near(l[0],x)&&near(l[1],y))return [l[2],l[3]];
		if(near(l[2],x)&&near(l[3],y))return [l[0],l[1]];
		return null;
	};
	for (const f of labs) {
		const rotation=Number(f.rotation??f.rot??0);
		if(Number.isFinite(rotation)&&((rotation%180)+180)%180!==0)
			dev.push({kind:'label-not-horizontal',net:f.net,at:[X(f),Y(f)],rotation});
		if (f.alignMode !== 6 && f.alignMode !== 8)
			dev.push({ kind:'bad-alignmode', net:f.net, at:[X(f),Y(f)], alignMode:f.alignMode ?? null });
		const verticalAnchor=String(f.align||f.anchor||'').toUpperCase().split('_')[1];
		if(verticalAnchor==='MIDDLE')
			dev.push({kind:'anchor-middle',net:f.net,at:[X(f),Y(f)],align:f.align||f.anchor});
		const own = f.wireId ? segs.filter(s=>s.group===f.wireId) : segs.filter(s=>!f.net||!s.net||s.net===f.net);
		const incident = own.map(s=>({s,other:endpoint(f,s)})).filter(x=>x.other);
		const horizontal = incident.filter(x=>near(x.s.line[1],x.s.line[3]));
		if (model._labelCoverage && (incident.length!==1 || horizontal.length!==1)) {
			dev.push({kind:incident.length?'label-anchor-not-free-horizontal-end':'label-anchor-off-wire',net:f.net,
				at:[X(f),Y(f)],incident:incident.length,horizontalEnds:horizontal.length});
			continue;
		}
		if(horizontal.length===1){
			const ox=horizontal[0].other[0];
			if(!near(ox,X(f)))geometrySide.set(f,ox>X(f)?'left':'right');
		}
		const side=geometrySide.get(f); if(!side)continue;
		const expectMode=side==='left'?6:8, expect=side==='left'?'LEFT_BOTTOM':'RIGHT_BOTTOM';
		const actual=String(f.align||f.anchor||'').toUpperCase();
		if(f.alignMode!==expectMode || (actual && actual!==expect))
			dev.push({kind:'anchor-wrong-side',net:f.net,side,at:[X(f),Y(f)],align:f.align||f.anchor||null,alignMode:f.alignMode,expect,expectMode});
	}
	const sideOf = f => geometrySide.get(f) || (f.alignMode===6?'left':f.alignMode===8?'right':null);
	for (const side of ['left', 'right']) {
		const g = labs.filter(f => sideOf(f) === side);
		if (g.length < 2) continue;   /* 同侧仅 0/1 个标签:无所谓成列 */
		/* 按 x 聚列:排序后相邻 x 间隔 ≤ xTol 归同列,> xTol 起新列 */
		const sorted = [...g].sort((a, b) => X(a) - X(b));
		const columns = [];
		let cur = [sorted[0]];
		for (let i = 1; i < sorted.length; i++) {
			if (X(sorted[i]) - X(sorted[i - 1]) <= v.xTol) cur.push(sorted[i]);
			else { columns.push(cur); cur = [sorted[i]]; }
		}
		columns.push(cur);
		for (const col of columns) {
			const cx = col.map(X);
			if (col.length < 2) continue;   /* 单标签列:无可对齐/比行距对象,跳过(防散布由生成器按构造保证,裁判不拒小模块单侧标签) */
			if (Math.max(...cx) - Math.min(...cx) > v.xTol) dev.push({ kind: 'column-x-spread', side, spread: +(Math.max(...cx) - Math.min(...cx)).toFixed(1) });
			const ys = col.map(Y).sort((a, b) => a - b);
			for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] < v.minPitch) { dev.push({ kind: 'row-pitch-merged', side, pitch: +(ys[i] - ys[i - 1]).toFixed(1) }); break; }
		}
	}
	return { token: 'T-LABEL-ALIGN', conform: dev.length === 0, deviations: dev, detail: { labels: labs.length } };
}

// DR27: endpoints that terminate pins on the same side of one component share
// a visual baseline. Local wire geometry defines membership, so equal global
// net names elsewhere on the sheet never merge unrelated groups.
export function checkFlagAlign(model) {
	const tol = tokenById('T-FLAG-ALIGN').value.axisTolerance;
	const flags = (model.netflags || []).filter(f => Number.isFinite(f.x ?? f.textX) && Number.isFinite(f.y ?? f.textY));
	const wires = [];
	for (const w of model.wires || []) {
		const L = w.line || [];
		for (let i = 0; i + 3 < L.length; i += 2) wires.push({ a:[L[i],L[i+1]], b:[L[i+2],L[i+3]] });
	}
	const key = (x,y) => `${Math.round(x*1000)/1000},${Math.round(y*1000)/1000}`;
	const dev=[], groups=[];
	// EasyEDA only attaches a net flag at a wire endpoint or directly at a pin.
	// A symbol drawn over a segment interior looks connected but is electrically
	// floating, so reject it before native DRC is needed to discover the defect.
	const electricalAnchors=new Set();
	for(const s of wires){electricalAnchors.add(key(...s.a));electricalAnchors.add(key(...s.b));}
	for(const c of model.components||[])for(const p of c.pins||[])
		if(Number.isFinite(p.x)&&Number.isFinite(p.y))electricalAnchors.add(key(p.x,p.y));
	for(const f of flags){
		const at=[f.x??f.textX,f.y??f.textY];
		if(!electricalAnchors.has(key(...at)))dev.push({kind:'flag-anchor-not-wire-or-pin-endpoint',id:f.id||null,net:f.net||'',at});
		const netClass=classOfNet(f.net);
		if(f.kind==='sig' && netClass!=='sig') dev.push({kind:'power-or-ground-uses-signal-label',id:f.id||null,net:f.net||'',netClass,at});
	}
	const parent = new Map();
	const add = k => { if (!parent.has(k)) parent.set(k,k); };
	const find = k => {
		add(k); let p=parent.get(k);
		while (p !== parent.get(p)) p=parent.get(p);
		let n=k; while (parent.get(n)!==p) { const q=parent.get(n); parent.set(n,p); n=q; }
		return p;
	};
	const join = (a,b) => { const x=find(a),y=find(b); if(x!==y)parent.set(x,y); };
	for (const s of wires) { const a=key(...s.a),b=key(...s.b); add(a);add(b);join(a,b); }
	for (const c of model.components || []) for (const p of c.pins || []) if(Number.isFinite(p.x)&&Number.isFinite(p.y))add(key(p.x,p.y));
	for (const f of flags) add(key(f.x??f.textX,f.y??f.textY));
	// Join pins, flags and T-junctions that lie on an orthogonal segment interior.
	for (const k of [...parent.keys()]) {
		const [x,y]=k.split(',').map(Number);
		for (const s of wires) {
			const on = s.a[0]===s.b[0]
				? Math.abs(x-s.a[0])<1e-6 && y>=Math.min(s.a[1],s.b[1])-1e-6 && y<=Math.max(s.a[1],s.b[1])+1e-6
				: s.a[1]===s.b[1] && Math.abs(y-s.a[1])<1e-6 && x>=Math.min(s.a[0],s.b[0])-1e-6 && x<=Math.max(s.a[0],s.b[0])+1e-6;
			if(on)join(k,key(...s.a));
		}
	}
	for (const c of model.components || []) {
		if(!c.bbox)continue;
		const roots=new Set((c.pins||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).map(p=>find(key(p.x,p.y))));
		const linked=flags.filter(f=>roots.has(find(key(f.x??f.textX,f.y??f.textY))));
		const sideOf=f=>{
			const x=f.x??f.textX,y=f.y??f.textY,b=c.bbox;
			const distance={left:b.minX-x,right:x-b.maxX,bottom:b.minY-y,top:y-b.maxY};
			return Object.entries(distance).filter(([,v])=>v>=-1).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
		};
		for(const side of ['left','right','top','bottom'])for(const symbolClass of ['ground','power','sig']){
			const endpointClass=f=>{const byNet=classOfNet(f.net);return byNet==='sig'?(f.kind||'sig'):byNet;};
			const fs=linked.filter(f=>sideOf(f)===side&&endpointClass(f)===symbolClass); if(fs.length<2)continue;
			const axis=(side==='top'||side==='bottom')?'y':'x';
			const vals=fs.map(f=>f[axis]??f[axis==='x'?'textX':'textY']);
			const spread=Math.max(...vals)-Math.min(...vals), base={component:c.designator||c.id,side,symbolClass,axis,n:fs.length,spread:+spread.toFixed(1)};
			groups.push(base);
			const objects=fs.map(f=>({id:f.id||null,net:f.net||'',at:[f.x??f.textX,f.y??f.textY]}));
			if(spread>tol)dev.push({kind:symbolClass==='sig'?'same-side-signal-axis-spread':'same-side-flag-axis-spread',...base,tolerance:tol,objects});
		}
	}
	return res('T-FLAG-ALIGN',dev,{groups:groups.length,axisTolerance:tol,checked:groups});
}

// T-DRC: DRC error/warn/info 全为 0 即符合;缺失或非数字视为不符
export function checkDrc(drc = {}) {
	const tok = tokenById('T-DRC');
	const v = tok ? tok.value : { error: 0, warn: 0, info: 0 };
	const fin = k => Number.isFinite(drc[k]) ? drc[k] : null;
	const e = fin('error'), w = fin('warn'), i = fin('info');
	const dev = [];
	if (e !== v.error) {
		dev.push({ kind: 'drc-error', got: e });
	}
	if (w !== v.warn) {
		dev.push({ kind: 'drc-warn', got: w });
	}
	if (i !== v.info) {
		dev.push({ kind: 'drc-info', got: i });
	}
	return res('T-DRC', dev, { error: e, warn: w, info: i });
}

// T-FLAG-ORIENT: 电源/地符号朝向。EasyEDA live/source-twin 几何使用笛卡尔坐标(y 向上)。去耦电容两脚:
// 电源符号必须落在【视觉上方】(model y > 件中心)、地符号【视觉下方】(model y < 件中心)。反了=器件上下颠倒。
// 由几何独立判定(不信引擎自报):对每个 2 脚件,取其 x 邻近、y 跨度内的电源/地 netflag,
// 视觉上方的须 power、下方的须 ground;违反则 ✗。这正是用户肉眼看到的"电源/地符号反了"。
function classOfNet(net) {
	const n = String(net || '');
	if (/(^|[_\-./])(a|d|p)?gnd\d*([_\-./]|$)|(^|[_\-./])v(ss|ee)\d*([_\-./]|$)/i.test(n)) return 'ground';
	// Control/status nets often include the rail they describe (PG_3V3,
	// EN_5V, RESET_1V8). The voltage suffix does not turn them into rails.
	if (/(^|[_\-./])(pg|pwrgd|power_?good|reset|rst|en|enable|ok|fault|alert|int|sense)([_\-./]|$)/i.test(n)) return 'sig';
	if (/^\+/.test(n)
		|| /(^|[_\-./])(vcc|vdd|vbat|vbus|vsys|vin|vout|vdda|vddio|vref|vpp|vaa)\d*/i.test(n)
		|| /(^|[_\-./])\d+v\d*([_\-./]|$)/i.test(n)) return 'power';
	return 'sig';
}
export function checkFlagOrient(model) {
	const v = tokenById('T-FLAG-ORIENT').value;
	/* 按【net 类别】认电源/地符号 —— live readGeometry 的 netflag 只有 net 名没有 kind,不能靠 f.kind 过滤(否则 live 判瞎)。 */
	const flags = (model.netflags || []).filter(f => { const k = f.kind || classOfNet(f.net); return k === 'power' || k === 'ground'; });
	const segments=[];
	for(const w of model.wires||[]){const l=w.line||[];for(let i=0;i+3<l.length;i+=2)segments.push({a:[l[i],l[i+1]],b:[l[i+2],l[i+3]]});}
	const parent=new Map(),key=(x,y)=>`${Math.round(x*1e6)/1e6},${Math.round(y*1e6)/1e6}`;
	const add=k=>{if(!parent.has(k))parent.set(k,k);return k;};
	const find=k=>{add(k);while(parent.get(k)!==k){parent.set(k,parent.get(parent.get(k)));k=parent.get(k);}return k;};
	const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(a,b);};
	const on=([x,y],s)=>s.a[0]===s.b[0]?Math.abs(x-s.a[0])<1e-6&&y>=Math.min(s.a[1],s.b[1])-1e-6&&y<=Math.max(s.a[1],s.b[1])+1e-6:
		s.a[1]===s.b[1]&&Math.abs(y-s.a[1])<1e-6&&x>=Math.min(s.a[0],s.b[0])-1e-6&&x<=Math.max(s.a[0],s.b[0])+1e-6;
	for(const s of segments)join(key(...s.a),key(...s.b));
	for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
		for(const p of [segments[i].a,segments[i].b])if(on(p,segments[j]))join(key(...p),key(...segments[j].a));
		for(const p of [segments[j].a,segments[j].b])if(on(p,segments[i]))join(key(...p),key(...segments[i].a));
	}
	const attach=point=>{const k=key(...point);add(k);for(const s of segments)if(on(point,s))join(k,key(...s.a));return find(k);};
	const flagRoots=new Map(flags.map(f=>[f,attach([f.x??f.textX,f.y??f.textY])]));
	const dev = [];
	for(const f of model.netflags||[]){
		if(classOfNet(f.net)==='power'&&f.nameVisible===false)
			dev.push({kind:'power-flag-name-hidden',id:f.id||null,net:f.net||'',at:[f.x??f.textX,f.y??f.textY]});
		const rotation=Number(f.nameRotation??0);
		if(classOfNet(f.net)==='power'&&f.nameVisible!==false&&Number.isFinite(rotation)&&((rotation%180)+180)%180!==0)
			dev.push({kind:'power-flag-name-not-horizontal',id:f.id||null,net:f.net||'',at:[f.x??f.textX,f.y??f.textY],rotation});
		const pose=((Number(f.rotation)||0)%360+360)%360,fy=f.y??f.textY;
		if(classOfNet(f.net)==='power'&&f.nameVisible!==false&&pose===0&&f.nameBox&&f.nameBox.minY<fy-1e-6)
			dev.push({kind:'power-flag-name-not-outward',id:f.id||null,net:f.net||'',at:[f.x??f.textX,fy],nameBox:f.nameBox});
		if(classOfNet(f.net)==='power'&&f.nameVisible!==false&&(pose===90||pose===270)&&f.nameBox){
			const centerY=(f.nameBox.minY+f.nameBox.maxY)/2,offset=centerY-fy;
			if(Math.abs(offset)>1)dev.push({kind:'power-flag-name-cross-axis-offset',id:f.id||null,net:f.net||'',
				at:[f.x??f.textX,fy],pose,centerY:+centerY.toFixed(2),offset:+offset.toFixed(2),required:'vertical-center'});
		}
		const fx=f.x??f.textX,fb=f.bbox;
		if((classOfNet(f.net)==='power'||classOfNet(f.net)==='ground')&&fb&&Number.isFinite(fx)&&Number.isFinite(fy)){
			const incident=segments.filter(s=>{
				const ea=Math.abs(s.a[0]-fx)<1e-6&&Math.abs(s.a[1]-fy)<1e-6;
				const eb=Math.abs(s.b[0]-fx)<1e-6&&Math.abs(s.b[1]-fy)<1e-6;
				return ea||eb;
			});
			for(const s of incident){
				const ea=Math.abs(s.a[0]-fx)<1e-6&&Math.abs(s.a[1]-fy)<1e-6,other=ea?s.b:s.a;
				const wx=other[0]-fx,wy=other[1]-fy,bx=(fb.minX+fb.maxX)/2-fx,by=(fb.minY+fb.maxY)/2-fy;
				const wireHorizontal=Math.abs(wx)>=Math.abs(wy),bodyHorizontal=Math.abs(bx)>=Math.abs(by);
				if(wireHorizontal!==bodyHorizontal||wx*bx+wy*by>=-1e-6){
					dev.push({kind:'flag-symbol-not-opposed-to-stub',id:f.id||null,net:f.net||'',at:[fx,fy],stub:[other[0],other[1],fx,fy],bodyBox:fb});
					break;
				}
			}
		}
	}
	for (const c of model.components || []) {
		if ((c.pins || []).length !== 2 || !c.bbox) continue;
		const cx=(c.bbox.minX+c.bbox.maxX)/2,cy = (c.bbox.minY + c.bbox.maxY) / 2;
		const pys=(c.pins||[]).map(p=>p.y).filter(Number.isFinite),pyMin=pys.length?Math.min(...pys):cy,pyMax=pys.length?Math.max(...pys):cy,R=24;
		const pinRoots=new Set((c.pins||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).map(p=>attach([p.x,p.y])));
		const linked=flags.filter(f=>{const fx=f.x??f.textX,fy=f.y??f.textY;return pinRoots.has(flagRoots.get(f))&&
			Math.abs(fx-cx)<v.xTol&&fy>=pyMin-R&&fy<=pyMax+R;});
		for (const f of linked) {
			const cls = classOfNet(f.net);
			if (cls === 'sig') continue;
			const up = (f.y ?? f.textY) > cy;   /* EasyEDA model: 大 y = 视觉上方 */
			/* 视觉上方须电源、下方须地;反了即朝向颠倒 */
			if (up && cls !== 'power') dev.push({ kind: 'flag-reversed', designator: c.designator, net: f.net, side: 'top-should-be-power' });
			else if (!up && cls !== 'ground') dev.push({ kind: 'flag-reversed', designator: c.designator, net: f.net, side: 'bottom-should-be-ground' });
			if(f.bbox){
				const dx=Math.max(c.bbox.minX-f.bbox.maxX,f.bbox.minX-c.bbox.maxX,0);
				const dy=Math.max(c.bbox.minY-f.bbox.maxY,f.bbox.minY-c.bbox.maxY,0);
				const clearance=Math.hypot(dx,dy);
				if(clearance<5-1e-6)dev.push({kind:'flag-body-clearance',designator:c.designator,net:f.net,
					flag:f.id||null,clearance,required:5});
			}
		}
	}
	return res('T-FLAG-ORIENT', dev, { reversed: dev.length, association:'physical-wire-component' });
}

// T-ADJACENCY: 每个 2 脚无源件须【贴 + 直连】它服务的 IC 脚 —— 存在【某个同网 IC 脚】与无源件靶脚在同一 wire
//   连通分量(=真用导线连,非 net 标签远连)【且】该已连脚距离 ≤ 阈值(商用参考板实测,=物理贴脚)。
//   语义忠实用户意图(贴它服务的脚+直连短线):同网另一 IC 凑巧几何更近【但未连】,不据此判 not-direct ——
//   只要本件确用导线连到了同网某 IC 脚且贴得够近即可。仅靠 net 标签(无任何已连脚)= not-direct(老板=此态,仍被抓)。
//   靶:去耦 cap → 同网 IC 电源脚;上拉/串 R → 同网 IC 信号脚。pin→net 用权威网表 opts.nets(无则跳,不臆测)。
export function checkAdjacency(model, opts = {}) {
	const nets = opts.nets;
	if (!nets) return opts.requireEvidence
		? res('T-ADJACENCY', [{ kind: 'missing-authoritative-netlist' }], { skipped: 'no-netlist', evidenceRequired: true })
		: res('T-ADJACENCY', [], { skipped: 'no-netlist', evidenceRequired: false });
	const TH = opts.adjacency || tokenById('T-ADJACENCY').value;
	const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
	const par = new Map();
	const add = a => { if (!par.has(a)) par.set(a, a); return a; };
	const find = a => { add(a); while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
	const uni = (a, b) => { par.set(find(a), find(b)); };
	const segments=[];
	for (const w of model.wires || []) { const L = w.line || []; for (let i = 0; i + 3 < L.length; i += 2) {
		const a=[L[i],L[i+1]],b=[L[i+2],L[i+3]];uni(key(...a),key(...b));segments.push({a,b});
	} }
	// EDA connects a branch whose endpoint lands on the interior of another
	// orthogonal segment. Endpoint-only union falsely classified valid T branches
	// as label-only connections, so include every wire vertex and component pin.
	const onSegment=(x,y,{a,b})=>a[1]===b[1]
		? Math.abs(y-a[1])<1&&x>=Math.min(a[0],b[0])-0.5&&x<=Math.max(a[0],b[0])+0.5
		: a[0]===b[0]&&Math.abs(x-a[0])<1&&y>=Math.min(a[1],b[1])-0.5&&y<=Math.max(a[1],b[1])+0.5;
	const touch=[];
	for(const s of segments)touch.push(s.a,s.b);
	for(const c of model.components||[])for(const p of c.pins||[])touch.push([p.x,p.y]);
	for(const [x,y] of touch)for(const s of segments)if(onSegment(x,y,s)){uni(key(x,y),key(...s.a));uni(key(x,y),key(...s.b));}
	const comp = (x, y) => (par.has(key(x, y)) ? find(key(x, y)) : null);
	const anchorPins = [];
	for (const c of model.components || []) {
		const ref=String(c.designator||''), name=String(c.name||c.value||'');
		const switchAnchor=/^(SW|S|KEY)\d/i.test(ref)||/(switch|tact|button|按键|开关)/i.test(name);
		if ((c.pins || []).length < 3 && !switchAnchor) continue;
		const m = nets[c.designator] || {};
		const role = /^(J|P|CN|CON)\d/i.test(c.designator || '') ? 'connector' : switchAnchor ? 'switch' : 'device';
		for (const p of c.pins) { const net = m[p.num]; if (net) anchorPins.push({ des: c.designator, role, net, x: p.x, y: p.y }); }
	}
	// A regulator feedback divider is a local three-endpoint topology: one
	// multi-pin device input plus two resistor ends, whose opposite ends go to
	// power and ground. Two real signal labels may replace the long physical
	// feedback return when they terminate separate wire components. This avoids
	// routing back through the device fanout without relying on a specific net.
	const labelledDividerNets = new Set();
	for (const net of new Set(anchorPins.filter(p => p.role === 'device').map(p => p.net))) {
		const supports = [];
		for (const c of model.components || []) {
			if (!/^R\d/i.test(String(c.designator || '')) || (c.pins || []).length !== 2) continue;
			const mapped = nets[c.designator] || {}, hit = c.pins.find(p => mapped[p.num] === net);
			if (!hit) continue;
			const other = c.pins.find(p => p !== hit);
			supports.push(classOfNet(mapped[other.num] || ''));
		}
		if (!supports.includes('power') || !supports.includes('ground')) continue;
		const roots = new Set((model.netflags || []).filter(f => (f.kind || classOfNet(f.net)) === 'sig' && f.net === net)
			.map(f => comp(f.x ?? f.textX, f.y ?? f.textY)).filter(Boolean));
		if (roots.size >= 2) labelledDividerNets.add(net);
	}
	const capFarads = value => {
		const m = String(value || '').trim().match(/^([0-9]*\.?[0-9]+)\s*([pnumµ]?)(?:f)?$/i);
		if (!m) return null;
		const scale = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, '': 1 }[m[2].toLowerCase()];
		return Number(m[1]) * scale;
	};
	/* 先收集每个 2 脚无源件的【靶脚连通分量 + 中心 + 靶网 + 阈值】 */
	const items = [];
	for (const c of model.components || []) {
		if (!/^[RCL]\d/i.test(String(c.designator||''))) continue;
		const pins = c.pins || []; if (pins.length !== 2 || !c.bbox) continue;
		const m = nets[c.designator] || {};
		const pn = pins.map(p => ({ p, net: m[p.num], cls: classOfNet(m[p.num] || '') }));
		if (pn.some(x => !x.net)) continue;
		const isDecap = pn.some(x => x.cls === 'power') && pn.some(x => x.cls === 'ground');
		const targetPin = isDecap ? pn.find(x => x.cls === 'power') : pn.find(x => x.cls === 'sig');
		if (!targetPin) continue;                       /* 无明确服务脚(两端皆电源/地等)→跳 */
		const cx = (c.bbox.minX + c.bbox.maxX) / 2, cy = (c.bbox.minY + c.bbox.maxY) / 2;
		const hasConnector = anchorPins.some(x => x.net === targetPin.net && x.role === 'connector');
		const isBulk = isDecap && capFarads(c.value || (c.attrs || []).find(a => a.key === 'Value')?.value) >= 1e-6;
		const th = isBulk ? (TH.bulkCap ?? TH.decap) : !isDecap && hasConnector ? (TH.interfaceTermination ?? TH.pull) : isDecap ? TH.decap : TH.pull;
		items.push({ c, isDecap, isBulk, hasConnector, targetNet: targetPin.net, th,
			cx, cy, tpx: targetPin.p.x, tpy: targetPin.p.y, pc: comp(targetPin.p.x, targetPin.p.y) });
	}
	const dev = []; let checked = 0;
	// A converter output capacitor is often on the far side of a series L/R.
	// Recognize that generic physical chain only when the support part's other
	// pin is itself directly wired to a real device pin; a pair of matching net
	// labels alone still cannot satisfy adjacency.
	const bridges=[];
	for(const c of model.components||[]){
		if(!/^[LR]\d/i.test(String(c.designator||''))||(c.pins||[]).length!==2||!c.bbox)continue;
		const mapped=nets[c.designator]||{},pins=c.pins;
		for(let i=0;i<2;i++){
			const target=pins[i],other=pins[1-i],targetNet=mapped[target.num],otherNet=mapped[other.num];
			if(!targetNet||!otherNet)continue;
			const oc=comp(other.x,other.y),cx=(c.bbox.minX+c.bbox.maxX)/2,cy=(c.bbox.minY+c.bbox.maxY)/2;
			const anchored=anchorPins.some(p=>p.role==='device'&&p.net===otherNet&&oc&&comp(p.x,p.y)===oc&&Math.hypot(cx-p.x,cy-p.y)<=Math.max(TH.pull??0,TH.decap??0));
			if(anchored)bridges.push({targetNet,pc:comp(target.x,target.y),x:target.x,y:target.y,designator:c.designator});
		}
	}
	/* hugsIc[i]=该件靶脚连通分量内有同网 IC 脚且距≤阈值(直接贴 IC)。anyPin/bestAny/bestConn 同前。 */
	const info = items.map(it => {
		let anyPin = false, bestAny = Infinity, bestConn = Infinity;
		for (const ip of anchorPins) {
			if (ip.net !== it.targetNet || ip.des === it.c.designator) continue;
			anyPin = true; const d = Math.hypot(it.cx - ip.x, it.cy - ip.y); if (d < bestAny) bestAny = d;
			if (it.pc && comp(ip.x, ip.y) === it.pc && d < bestConn) bestConn = d;
		}
		const bridge=bridges.filter(b=>b.targetNet===it.targetNet&&it.pc&&b.pc===it.pc)
			.map(b=>({...b,d:Math.hypot(it.cx-b.x,it.cy-b.y)})).sort((a,b)=>a.d-b.d)[0];
		if(bridge&&bridge.d<bestConn)bestConn=bridge.d;
		const labelledDivider = labelledDividerNets.has(it.targetNet) && bestAny <= Math.max(TH.interfaceTermination ?? 0, (TH.pull ?? 0) * 1.5);
		return { anyPin, bestAny, bestConn, bridge:bridge?.designator||null, labelledDivider,
			hugs: anyPin && (bestConn <= it.th || labelledDivider) };
	});
	/* ★簇链定点(用户规则:同网件聚成簇、簇贴IC):件 i 若【贴另一已贴件 j(同网+同连通+距≤阈值)】→ 也算贴。
	 *   迭代至不动点;只沿"已贴"传播 → 起点必是某件真贴 IC,不会让整簇漂离 IC(防放水)。 */
	for (let iter = 0; iter < items.length; iter++) {
		let changed = false;
		for (let i = 0; i < items.length; i++) {
			if (info[i].hugs || !info[i].anyPin) continue;
			const a = items[i]; if (!a.pc) continue;
			for (let j = 0; j < items.length; j++) {
				if (i === j || !info[j].hugs) continue;
				const b = items[j];
				if (b.targetNet !== a.targetNet || b.pc !== a.pc) continue;   /* 同网 + 同连通分量(真导线连成簇) */
				if (Math.hypot(a.cx - b.cx, a.cy - b.cy) <= a.th) { info[i].hugs = true; changed = true; break; }
			}
		}
		if (!changed) break;
	}
	for (let i = 0; i < items.length; i++) {
		const it = items[i], f = info[i];
		if (!f.anyPin) continue;                        /* 该网无 IC 脚(连接器等)→跳 */
		checked++;
		if (f.bestConn === Infinity && !f.labelledDivider) dev.push({ kind: 'not-direct', designator: it.c.designator, net: it.targetNet, dist: Math.round(f.bestAny), th: it.th });
		else if (!f.hugs) dev.push({ kind: 'too-far', designator: it.c.designator, net: it.targetNet, dist: Math.round(f.bestConn), th: it.th });
	}
	return res('T-ADJACENCY', dev, { nonAdjacent: dev.length, checked, labelledDividerNets: [...labelledDividerNets].sort() });
}

// tier3 视觉残余:几何量不到,留待 AI 按 checklist 判;此处只占位"待视觉",不臆测符合
function tier3Pending() {
	return [{ token: 'T-VISUAL', conform: null, deviations: [], detail: { note: '待与商用参考图并排视觉对照(commercial_judge runLiveJudge 截图层补判)' } }];
}

// Token registry and judge dispatch must remain one-to-one. This prevents a new
// design token from becoming documentation-only because its executable check was
// accidentally omitted. Unknown or duplicate judge results are equally unsafe.
export function auditTokenCoverage(results, tokens = TOKENS) {
	const expected = tokens.map(t => t.id);
	const actual = (results || []).map(r => r?.token).filter(Boolean);
	const count = id => actual.filter(x => x === id).length;
	const missing = expected.filter(id => count(id) === 0);
	const duplicate = expected.filter(id => count(id) > 1);
	const unexpected = [...new Set(actual.filter(id => !expected.includes(id)))];
	return {
		complete: missing.length === 0 && duplicate.length === 0 && unexpected.length === 0,
		expected: expected.length,
		checked: actual.length,
		missing,
		duplicate,
		unexpected,
	};
}

// DR25: a schematic footprint UUID/name is not manufacturing evidence.  Every
// fitted resistor/capacitor must have one per-reference electrical review and
// the source of the footprint currently bound in EasyEDA.  The public engine
// knows only generic refs and evidence contracts; circuit values stay in the
// caller-owned runtime evidence.
export function checkPassiveFootprints(model, {
	profiles = [], footprintSources = [], requireEvidence = false, requireLiveFootprintEvidence = false,
} = {}) {
	const passives = (model.components || []).filter(passiveKind);
	if (!passives.length) return res('T-PASSIVE', [], { checked: 0, profiles: profiles.length, footprintSources: footprintSources.length });
	if (!requireEvidence && !profiles.length && !footprintSources.length)
		return res('T-PASSIVE', [], { checked: 0, skipped: true, reason: 'passive evidence not requested' });
	const deviations = [];
	const byRef = new Map();
	for (const profile of profiles || []) {
		const ref = String(profile?.ref || '').trim();
		if (!ref) { deviations.push({ kind: 'passive-profile-ref-missing' }); continue; }
		if (byRef.has(ref)) deviations.push({ kind: 'passive-profile-duplicate', ref });
		else byRef.set(ref, profile);
	}
	const passiveRefs = new Set(passives.map(c => String(c.designator || '')));
	for (const ref of byRef.keys()) if (!passiveRefs.has(ref)) deviations.push({ kind: 'passive-profile-object-missing', ref });
	const sourceByUuid = new Map();
	for (const item of footprintSources || []) {
		const uuid = String(item?.footprintUuid || '').trim();
		if (uuid && !sourceByUuid.has(uuid)) sourceByUuid.set(uuid, item);
	}
	const resolvedByRef = {}, electricalByRef = {};
	for (const component of passives) {
		const ref = String(component.designator || '');
		const profile = byRef.get(ref);
		if (!profile) deviations.push({ kind: 'passive-electrical-profile-missing', ref });
		const source = String(profile?.source || profile?.basis || '').trim();
		const note = String(profile?.note || profile?.rationale || '').trim();
		if (profile && requireEvidence && (!source || !note)) deviations.push({ kind: 'passive-electrical-basis-incomplete', ref });
		const footprintUuid = String((component.attrs || []).find(a => a.key === 'Footprint')?.value || '').trim();
		const expectedUuid = String(profile?.footprintUuid || '').trim();
		if (expectedUuid && expectedUuid !== footprintUuid)
			deviations.push({ kind: 'passive-footprint-binding-mismatch', ref, expected: expectedUuid, actual: footprintUuid });
		const live = sourceByUuid.get(footprintUuid);
		if (!footprintUuid) deviations.push({ kind: 'passive-footprint-binding-missing', ref });
		if (requireLiveFootprintEvidence && live?.verified !== true)
			deviations.push({ kind: 'passive-footprint-live-source-unverified', ref, footprintUuid, error: live?.error || 'source unavailable' });
		const expectedLibrary = String(profile?.libraryUuid || '').trim(), actualLibrary = String(live?.resolvedLibraryUuid || '').trim();
		if (expectedLibrary && live?.verified === true && expectedLibrary !== actualLibrary)
			deviations.push({ kind: 'passive-footprint-library-mismatch', ref, expected: expectedLibrary, actual: actualLibrary });
		resolvedByRef[ref] = { footprintUuid, source: live?.verified === true ? live.sourceText : '' };
		if (profile) electricalByRef[ref] = profile;
	}
	const audit = auditPassiveFootprints(passives, { resolvedByRef, electricalByRef });
	for (const row of audit.rows) {
		if (!row.footprintConform) deviations.push({ kind: 'passive-footprint-nonconform', ref: row.ref, footprintUuid: row.footprintUuid, findings: row.footprint.deviations });
		if (byRef.has(row.ref) && !row.electricalConform) deviations.push({ kind: 'passive-electrical-not-approved', ref: row.ref, status: row.electrical?.status || 'MISSING' });
	}
	return res('T-PASSIVE', deviations, {
		checked: audit.detail.checked, profiles: profiles.length, footprintSources: footprintSources.length,
		footprintPass: audit.detail.footprintPass, electricalPass: audit.detail.electricalPass,
		rows: audit.rows,
	});
}

// 三层符合裁判(tier1=DRC底线, tier2=几何项, tier3=视觉占位)。opts.nets 给定(权威网表 pin→net)时启用 T-ADJACENCY。
export function judgeTokens(model, { drc, nets, moduleRegions, cellRegions, placementExceptions, connectorMountExceptions, connectorSemanticProfiles, connectorFootprintProfiles, highSpeedProfiles, passiveElectricalProfiles, passiveFootprintSources, adjacency,
	sheetBounds, titleBlockKeepout, pageClearance, requirePageEvidence = false, requireConnectorSemanticEvidence = false, requireLiveFootprintEvidence = false, requireHighSpeedEvidence = false, requirePassiveEvidence = false, requireNetlistEvidence = false, requireRegionEvidence = false } = {}) {
	const tier1 = checkDrc(drc);
	const tier2 = [
		checkOrtho(model), checkGrid(model), checkNoCross(model), checkNoThru(model), checkNoOverlap(model),
		checkTextOverlap(model), checkWireThruText(model), checkLabelCrowd(model), checkDensity(model),
		checkBodyClearance(model, { exceptions: placementExceptions }),
		checkPage(model, { sheetBounds, titleBlockKeepout, clearance: pageClearance, moduleRegions, requireEvidence: requirePageEvidence }),
		checkModuleSpacing(model, { moduleRegions }), checkCellSpacing(model, { cellRegions }),
		checkConnectorMountingPins(model, { nets, exceptions: connectorMountExceptions }),
		checkConnectorPinSemantics(model, { nets, profiles: connectorSemanticProfiles, footprintProfiles:connectorFootprintProfiles, requireEvidence: requireConnectorSemanticEvidence, requireLiveFootprintEvidence }),
		checkHighSpeedIntent(model, { nets, profiles: highSpeedProfiles, connectorProfiles: connectorSemanticProfiles, requireEvidence: requireHighSpeedEvidence }),
		checkPassiveFootprints(model, { profiles: passiveElectricalProfiles, footprintSources: passiveFootprintSources, requireEvidence: requirePassiveEvidence, requireLiveFootprintEvidence }),
		checkAnnotPlace(model), checkAnnotSide(model), checkAnnotFull(model), checkRegionCoverage(model,{moduleRegions,cellRegions,requireEvidence:requireRegionEvidence}),
		checkLabelAlign(model), checkFlagAlign(model), checkFlagOrient(model), checkAdjacency(model, { nets, adjacency, requireEvidence:requireNetlistEvidence }),
	];
	const tier3 = tier3Pending();
	const coverage = auditTokenCoverage([tier1, ...tier2, ...tier3]);
	const tier2bad = tier2.filter(r => !r.conform);
	const coverageDeviationCount = coverage.missing.length + coverage.duplicate.length + coverage.unexpected.length;
	const deviationCount = (tier1.conform ? 0 : tier1.deviations.length) + tier2bad.reduce((s, r) => s + r.deviations.length, 0) + coverageDeviationCount;
	const conform = coverage.complete && tier1.conform && tier2bad.length === 0;
	return { tier1, tier2, tier3, coverage, deviationCount, conform };
}

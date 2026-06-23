// 几何严标检查器(复用 geomQC,零特定电路内容,机械判)
import { tokenById } from './design_tokens.mjs';
import { geomQC } from './geom_qc.mjs';

const res = (id, deviations, detail) => ({ token: id, conform: deviations.length === 0, deviations, detail });

// T-ORTHO: 每段必 dx==0||dy==0,否则记偏离(严标 100%,零斜段)
export function checkOrtho(model) {
	const dev = [];
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const dx = l[i + 2] - l[i];
			const dy = l[i + 3] - l[i + 1];
			if (dx !== 0 && dy !== 0) {
				dev.push({ kind: 'diagonal-seg', at: [l[i], l[i + 1], l[i + 2], l[i + 3]] });
			}
		}
	}
	return res('T-ORTHO', dev, { nonOrtho: dev.length });
}

// T-GRID: 脚坐标必落 grid 倍数(严标 100%,无脱格脚)
export function checkGrid(model) {
	const tok = tokenById('T-GRID');
	const g = tok ? tok.value.grid : 5;
	const dev = [];
	for (const c of model.components || []) {
		for (const p of c.pins || []) {
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
				continue;
			}
			if (p.x % g !== 0 || p.y % g !== 0) {
				dev.push({ kind: 'off-grid-pin', at: [p.x, p.y] });
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
	if (c.cross > 0) dev.push({ kind: 'crossing', n: c.cross });
	if (c.shorts > 0) dev.push({ kind: 'mid-segment-touch', n: c.shorts });
	return res('T-NOCROSS', dev, { crossings: c.cross, shorts: c.shorts });
}

// T-NOTHRU: 线不穿件/脚(严标 max=0)
export function checkNoThru(model) {
	const c = geomCounts(model);
	return res('T-NOTHRU', c.thru ? [{ kind: 'wire-through-object', n: c.thru }] : [], { thru: c.thru });
}

// T-NOOVERLAP: 可见对象无重叠(严标 max=0)
export function checkNoOverlap(model) {
	const c = geomCounts(model);
	return res('T-NOOVERLAP', c.overlap ? [{ kind: 'overlap', n: c.overlap }] : [], { overlap: c.overlap });
}

// 内部助手:计算包围框中心
function bboxCenter(c) {
	return c.bbox ? [(c.bbox.minX + c.bbox.maxX) / 2, (c.bbox.minY + c.bbox.maxY) / 2] : [c.x, c.y];
}

// 内部助手:求数组中位数
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

// T-ANNOT-PLACE: 2脚件标号+阻值在件外、同侧(≥sameSideMinPct)
export function checkAnnotPlace(model) {
	const v = tokenById('T-ANNOT-PLACE').value;
	let total = 0, outside = 0, pair = 0, same = 0;
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
		for (const a of labs) {
			total++;
			if (!inside(a)) {
				outside++;
			}
		}
		if (d && n) {
			pair++;
			if (Math.sign(perp(d)) === Math.sign(perp(n)) && perp(d) !== 0) {
				same++;
			}
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
	return res('T-ANNOT-PLACE', dev, { outsidePct, sameSidePct, n: total });
}

// T-ANNOT-FULL: 2脚无源件须有可见值(Name)标注 ≥ minPct
export function checkAnnotFull(model) {
	const v = tokenById('T-ANNOT-FULL').value;
	const passives = (model.components || []).filter(c => (c.pins || []).length === 2);
	let withVal = 0;
	for (const c of passives) {
		if ((c.attrs || []).some(a => a.key === 'Name' && a.valueVisible && a.value)) {
			withVal++;
		}
	}
	const pct = passives.length ? +(withVal / passives.length * 100).toFixed(0) : 100;
	const dev = pct < v.minPct ? [{ kind: 'passives-missing-value', pct, need: v.minPct }] : [];
	return res('T-ANNOT-FULL', dev, { pct, passives: passives.length });
}

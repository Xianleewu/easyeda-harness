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
	return res('T-NOCROSS', c.cross ? [{ kind: 'crossing', n: c.cross }] : [], { crossings: c.cross, shorts: c.shorts });
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

// 商用级原理图规则集(冻结)。阈值源自商用参考图实测标定,见 spec §7.1。零特定电路内容。

export const THRESHOLDS = {
	GRID: 5,                    // 引脚吸附栅格(EDA 单位)
	GRID_SNAP_MIN_PCT: 95,      // CR-03
	ORTHO_MIN_PCT: 94,          // CR-02 原始线段正交率下限
	ROT_ALLOWED: [0, 90, 180, 270], // CR-04
	MIRROR_MAX_PCT: 5,          // CR-04 镜像占比上限(实测<1%,留余量)
	SPACING_MIN: 15,            // CR-05 最近邻最小中心距
	SPACING_MED_LO: 25,         // CR-05 中位下限(不太挤)
	SPACING_MED_HI: 90,         // CR-05 中位上限(不太散)
	LABEL_TO_LINE_MED_MAX: 12,  // CR-06 网名标签离所在线顶点中位上限
	LABEL_PERP_LO: 5,           // CR-10 标号/阻值垂直脚轴偏移下限
	LABEL_PERP_HI: 20,          // CR-10 上限
};

export const RUBRIC = [
	{ id: 'CR-01', dimension: '电气', desc: 'DRC 无 error', evidence: 'drc', severity: 'block' },
	{ id: 'CR-02', dimension: '走线', desc: '可见导线全正交;原始线段正交率达标,余为符号/引线噪声', evidence: 'geom+image-region', severity: 'block' },
	{ id: 'CR-03', dimension: '栅格', desc: '引脚坐标吸附到统一栅格', evidence: 'geom', severity: 'block' },
	{ id: 'CR-04', dimension: '朝向', desc: '器件仅用四正交旋转,镜像极少', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-05', dimension: '紧凑', desc: '相邻器件间距集中,不挤不散', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-06', dimension: '标签', desc: '网名标签贴所在线、对齐、不压器件', evidence: 'geom+image-region', severity: 'block' },
	{ id: 'CR-07', dimension: '连接', desc: '命名网络+标签为主连接,属常态不扣分;块内近距优先短直连', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-08', dimension: '图框', desc: '存在标准标题栏与图框', evidence: 'image-full', severity: 'flag' },
	{ id: 'CR-09', dimension: '标注', desc: '无源件带值/封装/参数标注;关键功能块有注释;可选电路有 DNP 标注', evidence: 'image-region', severity: 'flag' },
	{ id: 'CR-10', dimension: '标注摆放', desc: '标号/阻值在器件外、垂直脚轴偏移落格、同侧错开堆叠、不压件脚线不互盖', evidence: 'geom+image-region', severity: 'block' },
];

export function crOrthogonality(model) {
	let seg = 0, ortho = 0, deg45 = 0;
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			seg++;
			const dx = l[i + 2] - l[i], dy = l[i + 3] - l[i + 1];
			if (dx === 0 || dy === 0) ortho++;
			else if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1) deg45++;
		}
	}
	const orthoPct = seg ? +(ortho / seg * 100).toFixed(1) : 100;
	return { id: 'CR-02', pass: orthoPct >= THRESHOLDS.ORTHO_MIN_PCT, orthoPct, seg, ortho, deg45, other: seg - ortho - deg45 };
}

export function crGridSnap(model) {
	const g = THRESHOLDS.GRID;
	let total = 0, on = 0;
	for (const c of model.components || []) {
		for (const p of c.pins || []) {
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
			total++;
			if (p.x % g === 0 && p.y % g === 0) on++;
		}
	}
	const snapPct = total ? +(on / total * 100).toFixed(1) : 100;
	return { id: 'CR-03', pass: snapPct >= THRESHOLDS.GRID_SNAP_MIN_PCT, snapPct, total, on };
}

export function crRotation(model) {
	const comps = model.components || [];
	const rotDist = {};
	let bad = 0, mir = 0;
	for (const c of comps) {
		const r = ((c.rotation || 0) % 360 + 360) % 360;
		rotDist[r] = (rotDist[r] || 0) + 1;
		if (!THRESHOLDS.ROT_ALLOWED.includes(r)) bad++;
		if (c.mirror) mir++;
	}
	const mirrorPct = comps.length ? +(mir / comps.length * 100).toFixed(1) : 0;
	return { id: 'CR-04', pass: bad === 0 && mirrorPct <= THRESHOLDS.MIRROR_MAX_PCT, rotDist, badRot: bad, mirrorPct };
}

// 模块内 helper：器件包围盒中心坐标
function bboxCenter(c) {
	if (c.bbox) return [(c.bbox.minX + c.bbox.maxX) / 2, (c.bbox.minY + c.bbox.maxY) / 2];
	return [c.x, c.y];
}

// 模块内 helper：数组中位数(用于 CR-05 中位距离计算)
function median(arr) {
	if (!arr.length) return 0;
	const a = [...arr].sort((x, y) => x - y);
	return a[Math.floor(a.length / 2)];
}

export function crSpacing(model) {
	const cs = (model.components || []).map(bboxCenter).filter(p => Number.isFinite(p[0]));
	const dists = [];
	for (let i = 0; i < cs.length; i++) {
		let m = Infinity;
		for (let j = 0; j < cs.length; j++) {
			if (i === j) continue;
			const d = Math.hypot(cs[i][0] - cs[j][0], cs[i][1] - cs[j][1]);
			if (d < m) m = d;
		}
		if (m < Infinity) dists.push(m);
	}
	const minNN = dists.length ? +Math.min(...dists).toFixed(0) : 0;
	const medNN = +median(dists).toFixed(0);
	const pass = dists.length === 0 ||
		(minNN >= THRESHOLDS.SPACING_MIN && medNN >= THRESHOLDS.SPACING_MED_LO && medNN <= THRESHOLDS.SPACING_MED_HI);
	return { id: 'CR-05', pass, minNN, medNN, n: dists.length };
}

export function crNamedRatio(model) {
	const wires = model.wires || [];
	let named = 0;
	for (const w of wires) {
		if ((w.attrs || []).some(a => /name/i.test(a.key) && a.value)) named++;
	}
	const namedPct = wires.length ? Math.round(named / wires.length * 100) : 0;
	return { id: 'CR-07', pass: true, namedPct, named, total: wires.length };
}

export function crLabelToLine(model) {
	const dists = [];
	for (const w of model.wires || []) {
		const l = w.line || [];
		const verts = [];
		for (let i = 0; i + 1 < l.length; i += 2) verts.push([l[i], l[i + 1]]);
		for (const a of w.attrs || []) {
			if (!/name/i.test(a.key) || !a.value || !Number.isFinite(a.x)) continue;
			let m = Infinity;
			for (const v of verts) { const d = Math.hypot(a.x - v[0], a.y - v[1]); if (d < m) m = d; }
			if (m < Infinity) dists.push(m);
		}
	}
	dists.sort((x, y) => x - y);
	const medDist = +median(dists).toFixed(1);
	const p90 = dists.length ? +dists[Math.floor(dists.length * 0.9)].toFixed(1) : 0;
	return { id: 'CR-06', pass: dists.length === 0 || medDist <= THRESHOLDS.LABEL_TO_LINE_MED_MAX, medDist, p90, n: dists.length };
}

export function crLabelPlacement(model) {
	let total = 0, outside = 0;
	const perps = [];
	let sameSide = 0, pairCount = 0;
	for (const c of model.components || []) {
		const pins = c.pins || [];
		if (pins.length !== 2 || !c.bbox) continue;
		const horiz = Math.abs(pins[0].x - pins[1].x) >= Math.abs(pins[0].y - pins[1].y);
		const bb = c.bbox, bcx = (bb.minX + bb.maxX) / 2, bcy = (bb.minY + bb.maxY) / 2;
		const labels = (c.attrs || []).filter(a => (a.key === 'Designator' || a.key === 'Name') && a.valueVisible && Number.isFinite(a.x));
		const perpOf = a => horiz ? a.y - bcy : a.x - bcx;
		const inside = a => a.x >= bb.minX && a.x <= bb.maxX && a.y >= bb.minY && a.y <= bb.maxY;
		const desig = labels.find(a => a.key === 'Designator'), name = labels.find(a => a.key === 'Name');
		for (const a of labels) { total++; if (!inside(a)) outside++; const p = perpOf(a); if (p) perps.push(Math.abs(p)); }
		if (desig && name) { pairCount++; if (Math.sign(perpOf(desig)) === Math.sign(perpOf(name)) && perpOf(desig) !== 0) sameSide++; }
	}
	const outsidePct = total ? +(outside / total * 100).toFixed(0) : 100;
	const sameSidePct = pairCount ? +(sameSide / pairCount * 100).toFixed(0) : 100;
	const a = perps.sort((x, y) => x - y);
	const perpMed = a.length ? a[Math.floor(a.length / 2)] : 0;
	const pass = total === 0 ||
		(outsidePct === 100 && perpMed >= THRESHOLDS.LABEL_PERP_LO && perpMed <= THRESHOLDS.LABEL_PERP_HI && sameSidePct >= 70);
	return { id: 'CR-10', pass, outsidePct, perpMed, sameSidePct, n: total };
}

export function crDrc(drc = {}) {
	const error = Number.isFinite(drc.error) ? drc.error : null;  // null = DRC 无证据
	return { id: 'CR-01', pass: error === 0, error, warn: drc.warn ?? null, info: drc.info ?? null };
}

// 无纯几何判据规则(CR-08/CR-09)默认 pending,由视觉证据补判(Task 12)
function crPending(id) {
	return { id, pass: null, pending: true, note: '需视觉证据判定' };
}

export function scoreAll(model, { drc } = {}) {
	const rules = [
		crDrc(drc),
		crOrthogonality(model),
		crGridSnap(model),
		crRotation(model),
		crSpacing(model),
		crLabelToLine(model),
		crNamedRatio(model),
		crPending('CR-08'),
		crPending('CR-09'),
		crLabelPlacement(model),
	];
	const sev = id => (RUBRIC.find(r => r.id === id) || {}).severity;
	let blockFail = 0, flagFail = 0;
	for (const r of rules) {
		if (r.pass === false) {
			if (sev(r.id) === 'block') blockFail++;
			else flagFail++;
		}
	}
	return { rules, blockFail, flagFail, commercialPass: blockFail === 0 };
}

// 六支柱设计语言审计(对齐前端 6 支柱:每维 1-4 分 + PASS/FLAG/BLOCK，机械取证)。
//
// 支柱:① 结构/信号流 ② 紧凑/分离 ③ 布线 ④ 标签 ⑤ 支撑件贴合 ⑥ 惯例一致
// ①⑤ 依赖角色推断(role_infer，Phase 2):无 roles 时返回 PENDING(不打分、不阻塞)。
// 几何/标签证据由调用方注入(geomQC/labelQC)，便于单测。
import { fillEfficiency } from './design_conformance.mjs';

const DEFAULTS = { fillGood: 0.20, fillFlag: 0.12, fillBlock: 0.05 };

function pillarCompactness(snapshot, t) {
	const { ratio } = fillEfficiency(snapshot.components || []);
	let score, verdict;
	if (ratio >= t.fillGood) { score = 4; verdict = 'PASS'; }
	else if (ratio >= t.fillFlag) { score = 3; verdict = 'PASS'; }
	else if (ratio >= t.fillBlock) { score = 2; verdict = 'FLAG'; }
	else { score = 1; verdict = 'BLOCK'; }
	return { id: 'compactness', name: '紧凑/分离', score, verdict,
		evidence: { fillRatio: ratio },
		findings: verdict === 'PASS' ? [] : [`填充率 ${(ratio * 100).toFixed(1)}%（散落/空白过多）`] };
}

function pillarRouting(geom) {
	const wtc = (geom.wireThruComp || []).length;
	const diag = geom.diagonals || 0;
	const cross = geom.crossings || 0;
	let score = 4, verdict = 'PASS';
	const findings = [];
	if (wtc > 0) { findings.push(`线穿器件 ${wtc}`); verdict = 'BLOCK'; score = Math.min(score, 2); }
	if (diag > 0) { findings.push(`斜线段 ${diag}`); verdict = 'BLOCK'; score = 1; }
	if (cross > 0) { findings.push(`异网交叉 ${cross}`); if (verdict === 'PASS') verdict = 'FLAG'; score = Math.min(score, 3); }
	return { id: 'routing', name: '布线', score, verdict,
		evidence: { wireThroughComponent: wtc, diagonals: diag, crossings: cross }, findings };
}

function pillarLabels(labels) {
	const hard = (labels || []).filter(l => l.severity === 'hard').length;
	let score, verdict;
	if (hard === 0) { score = 4; verdict = 'PASS'; }
	else if (hard <= 2) { score = 2; verdict = 'BLOCK'; }
	else { score = 1; verdict = 'BLOCK'; }
	return { id: 'labels', name: '标签', score, verdict,
		evidence: { hardLabelIssues: hard },
		findings: hard ? [`hard 标签问题 ${hard}（浮空/压线/列不齐/假网名）`] : [] };
}

function pillarConventions(snapshot) {
	const netPorts = (snapshot.netflags || []).filter(f => f.type === 'netport').length;
	let score, verdict;
	if (netPorts === 0) { score = 4; verdict = 'PASS'; }
	else { score = 3; verdict = 'FLAG'; }
	return { id: 'conventions', name: '惯例一致', score, verdict,
		evidence: { netPorts },
		findings: netPorts ? [`尖头网口 ${netPorts}（单页图应避免）`] : [] };
}

function pillarPending(id, name, note) {
	return { id, name, score: null, verdict: 'PENDING', evidence: {}, findings: [`待 role_infer：${note}`] };
}

export function auditPillars(snapshot, opts = {}) {
	const t = { ...DEFAULTS, ...(opts.thresholds || {}) };
	const geom = opts.geom || { wireThruComp: [], crossings: 0, diagonals: 0, overlaps: [] };
	const labels = opts.labels || [];
	const roles = opts.roles || null;

	const pillars = [
		roles ? structureFromRoles(snapshot, roles) : pillarPending('structure', '结构/信号流', '模块质心 X 序 vs 角色'),
		pillarCompactness(snapshot, t),
		pillarRouting(geom),
		pillarLabels(labels),
		roles ? supportFromRoles(snapshot, roles, opts.logical) : pillarPending('support', '支撑件贴合', '支撑件到所服务引脚距离'),
		pillarConventions(snapshot),
	];

	const scored = pillars.filter(p => p.score != null);
	const totalScore = scored.reduce((s, p) => s + p.score, 0);
	const verdict = pillars.some(p => p.verdict === 'BLOCK') ? 'BLOCKED' : 'APPROVED';
	return { pillars, scored: scored.length, totalScore, maxScore: scored.length * 4, verdict };
}

const refOfPin = p => p.slice(0, p.lastIndexOf('.'));
const avg = a => a.reduce((s, v) => s + v, 0) / a.length;

function posByRef(snapshot) {
	const m = {};
	for (const c of snapshot.components || []) {
		const b = c.bbox;
		m[c.designator] = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: c.x, y: c.y };
	}
	return m;
}

function scoreByRatio(ratio) {
	if (ratio === 0) return { score: 4, verdict: 'PASS' };
	if (ratio <= 0.25) return { score: 3, verdict: 'FLAG' };
	if (ratio <= 0.5) return { score: 2, verdict: 'FLAG' };
	return { score: 1, verdict: 'BLOCK' };
}

/* ① 结构/信号流：模块质心 X 是否符合声明列序(左<控制器<右) */
function structureFromRoles(snapshot, roles) {
	const pos = posByRef(snapshot);
	const ctrlX = pos[roles.controller]?.x;
	let violations = 0, checked = 0;
	for (const m of roles.modules || []) {
		if (m.column === 'center') continue;
		const xs = m.parts.map(r => pos[r]?.x).filter(x => x != null);
		if (!xs.length || ctrlX == null) continue;
		checked++;
		const mx = avg(xs);
		if (m.column === 'left' && mx > ctrlX) violations++;
		else if (m.column === 'right' && mx < ctrlX) violations++;
	}
	const { score, verdict } = scoreByRatio(checked ? violations / checked : 0);
	return { id: 'structure', name: '结构/信号流', score, verdict,
		evidence: { checked, violations },
		findings: violations ? [`${violations}/${checked} 模块违反信号流列序`] : [] };
}

/* ⑤ 支撑件贴合：支撑无源件到所服务件(同信号网邻接)的距离 */
function supportFromRoles(snapshot, roles, logical) {
	const pos = posByRef(snapshot);
	const THRESH = 120;
	const adj = new Map();
	for (const n of (logical && logical.nets) || []) {
		if (n.class !== 'signal') continue;
		const refs = [...new Set(n.pins.map(refOfPin))];
		for (const a of refs) for (const b of refs) {
			if (a === b) continue;
			if (!adj.has(a)) adj.set(a, new Set());
			adj.get(a).add(b);
		}
	}
	let violations = 0, checked = 0;
	for (const p of (roles.parts || [])) {
		if (p.role !== 'support') continue;
		const sp = pos[p.ref];
		const neigh = [...(adj.get(p.ref) || [])].map(r => pos[r]).filter(Boolean);
		if (!sp || !neigh.length) continue;
		checked++;
		const mind = Math.min(...neigh.map(q => Math.hypot(q.x - sp.x, q.y - sp.y)));
		if (mind > THRESH) violations++;
	}
	const { score, verdict } = scoreByRatio(checked ? violations / checked : 0);
	return { id: 'support', name: '支撑件贴合', score, verdict,
		evidence: { checked, violations },
		findings: violations ? [`${violations}/${checked} 支撑件远离所服务引脚`] : [] };
}

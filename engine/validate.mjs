import { geomQC } from './geom_qc.mjs';
import { flagQC } from './flag_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { loadNetRegistry, netNameQC } from './net_registry.mjs';
import { buildNetlist } from './netlist.mjs';
import { connectivityQC } from './connectivity_qc.mjs';
import { pinWireGapQC } from './pin_wire_gap_qc.mjs';
import { drcQC } from './drc_pull.mjs';
import { physicalWireRoots, pointOnSegment } from './wire_geom.mjs';
import { logicalNetFlagRot } from './eda_rot.mjs';
import { buildModel as buildHarnessModel } from '../harness/model.mjs';
import { HARNESS_RULES, runRules } from '../harness/rule_registry.mjs';

function scoreOf(findings) {
	const bySev = { hard: 0, soft: 0, info: 0 };
	for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
	return { bySev, score: Math.max(0, 100 - bySev.hard * 3 - bySev.soft), pass: bySev.hard === 0 && bySev.soft === 0 && bySev.info === 0 };
}

const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;

function physicalNetNameQC(model) {
	const findings = [];
	const { groups } = physicalWireRoots(model.wires || []);
	for (const segs of groups.values()) {
		const nets = [...new Set(segs.map(s => s.net).filter(Boolean))];
		if (nets.length > 1) {
			findings.push({ rule: 'E4-mixed-physical-net', severity: 'hard', category: 'electrical',
				msg: `physical wire island has multiple net names: ${nets.join(',')}`,
				where: segs.filter(s => s.net).map(s => ({ net: s.net, line: s.line })) });
		}
	}
	for (const f of model.netflags || []) {
		if (!f.net) continue;
		for (const segs of groups.values()) {
			const touches = segs.some(s => pointOnSegment(f.x, f.y, s));
			if (!touches) continue;
			const nets = [...new Set(segs.map(s => s.net).filter(Boolean))];
			const different = nets.filter(n => n !== f.net);
			if (different.length) {
				findings.push({ rule: 'E4-flag-on-different-net', severity: 'hard', category: 'electrical',
					msg: `netflag ${f.net} placed on wire named ${different.join(',')}`,
					where: { flag: { net: f.net, x: f.x, y: f.y }, wireNets: different } });
			}
		}
	}
	return findings;
}

export function normalizeLiveWires(rawSnap) {
	const pinAt = new Map();
	for (const c of rawSnap.components || []) {
		for (const p of c.pins || []) pinAt.set(key(p.x, p.y), c.designator);
	}
	const wires = [];
	for (const w of rawSnap.wires || []) {
		const l = w.line || [];
		const step = l.length > 4 ? 4 : 2;
		for (let i = 0; i + 3 < l.length; i += step) {
			const line = [l[i], l[i + 1], l[i + 2], l[i + 3]];
			if (line[0] === line[2] && line[1] === line[3]) continue;
			wires.push({ id: w.id, net: w.net || '', line });
		}
	}
	return wires;
}

function applyExpectedNoConnects(components, expectedModel) {
	if (!expectedModel) return components;
	const expected = new Set();
	for (const c of expectedModel.components || []) {
		for (const p of c.pins || []) {
			const ref = `${c.designator}.${p.num}`;
			if (p.noConnected) expected.add(ref);
		}
	}
	return components.map(c => ({
		...c,
		pins: (c.pins || []).map(p => {
			const ref = `${c.designator}.${p.num}`;
			return { ...p, noConnected: expected.has(ref) };
		}),
	}));
}

function snapFlagsToWires(netflags, wires, tol = 3) {
	const endpoints = [];
	for (const w of wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 1 < l.length; i += 2) endpoints.push([l[i], l[i + 1]]);
	}
	return (netflags || []).map(f => {
		let best = null, bestD = Infinity;
		for (const [x, y] of endpoints) {
			const d = Math.hypot((f.x ?? 0) - x, (f.y ?? 0) - y);
			if (d < bestD) { bestD = d; best = [x, y]; }
		}
		const out = best && bestD <= tol ? { ...f, x: best[0], y: best[1] } : { ...f };
		if (out.type === 'netflag' || out.type === 'netport') out.rotation = logicalNetFlagRot(out.rotation ?? out.rot ?? 0);
		return out;
	});
}

function pushEngineFindings(findings, model, opts = {}) {
	if (!opts.skipGeom) {
		const g = geomQC(model);
		for (const s of g.overlaps)
			findings.push({ rule: 'G1-overlap', severity: 'hard', category: 'overlap', msg: `bbox overlap: ${s}`, where: s });
		for (const s of g.wireThruComp)
			findings.push({ rule: 'G2-wire-thru', severity: 'hard', category: 'overlap', msg: `wire through component: ${s}`, where: s });
		if (g.crossings)
			findings.push({ rule: 'G3-cross', severity: 'hard', category: 'wiring', msg: `different-net crossings: ${g.crossings}`, where: g.crossEx });
	}

	const f = flagQC(model);
	for (const b of f.badRot)
		findings.push({ rule: 'F1-flag-rot', severity: 'hard', category: 'orientation',
			msg: `${b.net} @(${b.x},${b.y}) rot=${b.rot} expected ${b.want}`, where: b });
	for (const w of f.wireThru)
		findings.push({ rule: 'F2-wire-thru-flag', severity: 'hard', category: 'overlap',
			msg: `wire through ${w.net} flag @(${w.x},${w.y})`, where: w });

	if (!opts.skipLabel) findings.push(...labelQC(model, opts.label || {}));
	findings.push(...physicalNetNameQC(model));
	findings.push(...connectivityQC(model));
	findings.push(...pinWireGapQC(model));
	findings.push(...netNameQC(model, loadNetRegistry()));
}

function pushHarnessFindings(findings, snapLike, opts = {}) {
	const components = opts.expectedModel ? applyExpectedNoConnects(snapLike.components || [], opts.expectedModel) : (snapLike.components || []);
	const harnessModel = buildHarnessModel({
		project: snapLike.project,
		components,
		wires: snapLike.wires || [],
		netflags: snapLike.netflags || [],
		texts: snapLike.texts || [],
		rectangles: snapLike.rectangles || [],
		sheetBBox: snapLike.sheetBBox,
	});
	findings.push(...runRules(harnessModel, HARNESS_RULES));
}

export function validateTemplate(model, snap) {
	const findings = [];
	pushEngineFindings(findings, model);
	pushHarnessFindings(findings, model);

	if (snap && process.env.EASYEDA_COMPARE_SNAP === '1') {
		const og = buildNetlist(snap), dg = buildNetlist(model);
		const groupSet = nets => {
			const m = new Map();
			for (const n of nets) {
				const refs = n.pins.map(p => p.ref).sort();
				for (const r of refs) m.set(r, refs.join(','));
			}
			return m;
		};
		const o = groupSet(og), d = groupSet(dg);
		let mism = 0; const ex = [];
		for (const [ref, oset] of o) {
			const ds = d.get(ref);
			if (ds !== oset) { mism++; if (ex.length < 12) ex.push(ref); }
		}
		if (mism) {
			findings.push({ rule: 'E1-net-equiv', severity: 'hard', category: 'electrical',
				msg: `reference snapshot pin grouping differs: ${mism}`, where: ex });
		}
	}

	return { findings, ...scoreOf(findings) };
}

export function validateLive(rawSnap, opts = {}) {
	const wires = normalizeLiveWires(rawSnap);
	const model = {
		components: applyExpectedNoConnects(rawSnap.components || [], opts.expectedModel),
		netflags: snapFlagsToWires(rawSnap.netflags || [], wires).map(f => ({
			...f,
			kind: f.type === 'netport' ? 'sig' : (f.net === 'GND' ? 'gnd' : 'power'),
			rot: f.rotation ?? f.rot ?? 0,
		})),
		wires,
	};
	const findings = [];
	pushEngineFindings(findings, model, { skipLabel: true });
	pushHarnessFindings(findings, { ...rawSnap, wires }, { expectedModel: opts.expectedModel });
	if (opts.drc) findings.push(...drcQC(opts.drcResult));
	return { findings, ...scoreOf(findings) };
}

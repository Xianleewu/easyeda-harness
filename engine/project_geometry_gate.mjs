import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeLiveWires } from './validate.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const MODEL = process.env.EASYEDA_PROJECT_MODEL || DIR + 'full_model.json';
const LIVE = process.env.EASYEDA_LIVE_MODEL || DIR + 'live.json';
const REPORT = process.env.EASYEDA_PROJECT_GEOMETRY_REPORT || DIR + 'project_geometry_report.json';
const RUN_LIVE = process.argv.includes('--live') || process.env.EASYEDA_PROJECT_GEOMETRY_LIVE === '1';
const SOURCE = RUN_LIVE ? LIVE : MODEL;
const SOURCE_LABEL = RUN_LIVE ? 'live.json' : 'full_model.json';
const EPS = 1e-6;

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function finite(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

function normBox(box) {
	if (!box || ![box.minX, box.minY, box.maxX, box.maxY].every(finite)) return null;
	return {
		minX: Math.min(box.minX, box.maxX),
		minY: Math.min(box.minY, box.maxY),
		maxX: Math.max(box.minX, box.maxX),
		maxY: Math.max(box.minY, box.maxY),
	};
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-geometry', msg, where });
}

function shrink(box, amount) {
	return {
		minX: box.minX + amount,
		minY: box.minY + amount,
		maxX: box.maxX - amount,
		maxY: box.maxY - amount,
	};
}

function boxesOverlap(a, b, clearance = 0) {
	return a.minX < b.maxX + clearance
		&& b.minX < a.maxX + clearance
		&& a.minY < b.maxY + clearance
		&& b.minY < a.maxY + clearance;
}

function pointInsideBox(x, y, box) {
	return x > box.minX + EPS && x < box.maxX - EPS && y > box.minY + EPS && y < box.maxY - EPS;
}

function segmentIntersectsBox(seg, box) {
	const r = shrink(box, 1);
	if (r.maxX <= r.minX || r.maxY <= r.minY) return false;
	if (pointInsideBox(seg.x1, seg.y1, r) || pointInsideBox(seg.x2, seg.y2, r)) return true;
	if (seg.x1 === seg.x2) {
		const x = seg.x1;
		if (x <= r.minX || x >= r.maxX) return false;
		return Math.min(seg.y1, seg.y2) < r.maxY && Math.max(seg.y1, seg.y2) > r.minY;
	}
	if (seg.y1 === seg.y2) {
		const y = seg.y1;
		if (y <= r.minY || y >= r.maxY) return false;
		return Math.min(seg.x1, seg.x2) < r.maxX && Math.max(seg.x1, seg.x2) > r.minX;
	}
	return boxesOverlap(segmentBox(seg), r);
}

function segmentBox(seg) {
	return {
		minX: Math.min(seg.x1, seg.x2),
		minY: Math.min(seg.y1, seg.y2),
		maxX: Math.max(seg.x1, seg.x2),
		maxY: Math.max(seg.y1, seg.y2),
	};
}

function samePoint(a, b) {
	return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

function crossPoint(a, b) {
	if (a.y1 === a.y2 && b.x1 === b.x2) return { x: b.x1, y: a.y1 };
	if (a.x1 === a.x2 && b.y1 === b.y2) return { x: a.x1, y: b.y1 };
	return null;
}

function pointOnSegmentInterior(point, seg) {
	if (!point) return false;
	if (seg.x1 === seg.x2) {
		return Math.abs(point.x - seg.x1) <= 1
			&& point.y > Math.min(seg.y1, seg.y2) + 1
			&& point.y < Math.max(seg.y1, seg.y2) - 1;
	}
	if (seg.y1 === seg.y2) {
		return Math.abs(point.y - seg.y1) <= 1
			&& point.x > Math.min(seg.x1, seg.x2) + 1
			&& point.x < Math.max(seg.x1, seg.x2) - 1;
	}
	return false;
}

function endpointAt(seg, point) {
	return samePoint({ x: seg.x1, y: seg.y1 }, point) || samePoint({ x: seg.x2, y: seg.y2 }, point);
}

function orthogonalCross(a, b) {
	const point = crossPoint(a, b);
	if (!point) return null;
	if (!pointOnSegmentInterior(point, a) && !endpointAt(a, point)) return null;
	if (!pointOnSegmentInterior(point, b) && !endpointAt(b, point)) return null;
	const aEndpoint = endpointAt(a, point);
	const bEndpoint = endpointAt(b, point);
	if (aEndpoint && bEndpoint) return null;
	return { point, aEndpoint, bEndpoint };
}

function wireSegments(wires) {
	const out = [];
	for (const w of asArray(wires)) {
		const l = asArray(w.line);
		for (let i = 0; i + 3 < l.length; i += 2) {
			const [x1, y1, x2, y2] = [Number(l[i]), Number(l[i + 1]), Number(l[i + 2]), Number(l[i + 3])];
			if (![x1, y1, x2, y2].every(finite)) continue;
			if (Math.abs(x1 - x2) <= EPS && Math.abs(y1 - y2) <= EPS) continue;
			out.push({
				id: w.id || '',
				net: String(w.net || ''),
				x1,
				y1,
				x2,
				y2,
				diagonal: Math.abs(x1 - x2) > EPS && Math.abs(y1 - y2) > EPS,
			});
		}
	}
	return out;
}

function textBox(text) {
	const box = normBox(text.bbox);
	if (box) return box;
	const content = String(text.content || '');
	const x = Number(text.x || 0);
	const y = Number(text.y || 0);
	return { minX: x, minY: y - 12, maxX: x + Math.max(24, content.length * 7), maxY: y + 4 };
}

function visibleObjects(snap, liveMode) {
	const objects = [];
	for (const comp of asArray(snap.components)) {
		const box = normBox(comp.bbox);
		if (box) objects.push({ kind: 'component', id: comp.id || comp.designator || '', label: comp.designator || comp.name || comp.id || 'component', box });
		for (const attr of asArray(comp.attrs)) {
			if (attr.keyVisible === false && attr.valueVisible === false) continue;
			const attrBox = normBox(attr.bbox);
			if (attrBox) objects.push({ kind: 'component-attr', id: attr.id || '', label: `${comp.designator || comp.id || 'component'}:${attr.key || 'attr'}`, box: attrBox });
		}
	}
	for (const flag of asArray(snap.netflags)) {
		const box = normBox(flag.bbox);
		if (box) objects.push({ kind: flag.kind === 'sig' || flag.type === 'netport' ? 'net-label' : 'net-flag', id: flag.id || '', label: `${flag.net || flag.symbol || 'netflag'}`, net: flag.net || '', box });
	}
	for (const text of asArray(snap.texts)) {
		const box = textBox(text);
		if (box) objects.push({ kind: 'text', id: text.id || '', label: String(text.content || '').slice(0, 60), box });
	}
	if (liveMode) {
		for (const wire of asArray(snap.wires)) {
			for (const attr of asArray(wire.attrs)) {
				if (!['Name', 'NET'].includes(String(attr.key || ''))) continue;
				if (attr.valueVisible === false) continue;
				const box = normBox(attr.bbox);
				if (box) objects.push({ kind: 'wire-name', id: attr.id || '', label: String(attr.value || wire.net || 'wire-name'), net: attr.value || wire.net || '', box });
			}
		}
	}
	return objects;
}

function normalizeSnap(snap, liveMode) {
	if (!liveMode) return snap;
	return {
		...snap,
		wires: normalizeLiveWires(snap),
		netflags: asArray(snap.netflags).map(flag => ({
			...flag,
			kind: flag.type === 'netport' ? 'sig' : (flag.net === 'GND' ? 'gnd' : 'power'),
		})),
	};
}

function validateProjectGeometry(snap, options = {}) {
	const liveMode = options.liveMode === true;
	const normalized = normalizeSnap(snap, liveMode);
	const findings = [];
	const segments = wireSegments(normalized.wires);
	const objects = visibleObjects(snap, liveMode);
	const componentObjects = objects.filter(obj => obj.kind === 'component');
	const visibleNonComponents = objects.filter(obj => obj.kind !== 'component');

	for (const seg of segments) {
		if (seg.diagonal) {
			hard(findings, 'PG1-wire-orthogonal', 'wires must be orthogonal', { wireId: seg.id, net: seg.net, segment: [seg.x1, seg.y1, seg.x2, seg.y2] });
		}
	}

	for (let i = 0; i < componentObjects.length; i++) {
		for (let j = i + 1; j < componentObjects.length; j++) {
			const a = componentObjects[i];
			const b = componentObjects[j];
			if (boxesOverlap(shrink(a.box, 1), shrink(b.box, 1))) {
				hard(findings, 'PG2-component-overlap', 'component bodies must not overlap', { a: a.label, b: b.label, boxes: [a.box, b.box] });
			}
		}
	}

	const crossSamples = [];
	for (let i = 0; i < segments.length; i++) {
		for (let j = i + 1; j < segments.length; j++) {
			const a = segments[i];
			const b = segments[j];
			if (a.diagonal || b.diagonal) continue;
			if (a.net && b.net && a.net === b.net) continue;
			const cross = orthogonalCross(a, b);
			if (!cross) continue;
			crossSamples.push({
				point: [cross.point.x, cross.point.y],
				nets: [a.net, b.net],
				segments: [[a.x1, a.y1, a.x2, a.y2], [b.x1, b.y1, b.x2, b.y2]],
			});
		}
	}
	if (crossSamples.length) hard(findings, 'PG3-wire-crossing', 'different or unnamed wires must not cross or touch mid-segment', { count: crossSamples.length, samples: crossSamples.slice(0, 20) });

	const wireThrough = [];
	for (const seg of segments) {
		for (const obj of objects) {
			if (obj.kind === 'text' && String(obj.label || '').trim() === '') continue;
			if (!segmentIntersectsBox(seg, obj.box)) continue;
			const ownLabel = ['net-label', 'wire-name'].includes(obj.kind) && obj.net && obj.net === seg.net;
			if (ownLabel) continue;
			wireThrough.push({ wireId: seg.id, net: seg.net, segment: [seg.x1, seg.y1, seg.x2, seg.y2], object: obj.label, objectKind: obj.kind, box: obj.box });
		}
	}
	if (wireThrough.length) hard(findings, 'PG4-wire-through-visible-object', 'wires must not pass through component bodies, text, labels, flags, or symbols', { count: wireThrough.length, samples: wireThrough.slice(0, 30) });

	const objectOverlaps = [];
	for (let i = 0; i < visibleNonComponents.length; i++) {
		for (let j = i + 1; j < visibleNonComponents.length; j++) {
			const a = visibleNonComponents[i];
			const b = visibleNonComponents[j];
			if (!boxesOverlap(shrink(a.box, 0.5), shrink(b.box, 0.5))) continue;
			objectOverlaps.push({ a: a.label, aKind: a.kind, b: b.label, bKind: b.kind, boxes: [a.box, b.box] });
		}
	}
	if (objectOverlaps.length) hard(findings, 'PG5-visible-object-overlap', 'text, attributes, net labels, GND symbols, and NC markers must not overlap each other', { count: objectOverlaps.length, samples: objectOverlaps.slice(0, 30) });

	const componentTextOverlaps = [];
	for (const obj of visibleNonComponents) {
		for (const comp of componentObjects) {
			if (obj.kind === 'net-flag' && obj.net && ['GND', 'SYS_3V3', 'SYS_5V', 'VIN_12_19V', 'VOUT_SW'].includes(obj.net)) continue;
			if (!boxesOverlap(shrink(obj.box, 0.5), shrink(comp.box, 1))) continue;
			componentTextOverlaps.push({ object: obj.label, objectKind: obj.kind, component: comp.label, boxes: [obj.box, comp.box] });
		}
	}
	if (componentTextOverlaps.length) hard(findings, 'PG6-visible-object-over-component', 'text, net labels, flags, and attributes must not overlap component bodies', { count: componentTextOverlaps.length, samples: componentTextOverlaps.slice(0, 30) });

	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		stats: {
			source: liveMode ? 'live' : 'model',
			components: asArray(snap.components).length,
			wires: asArray(snap.wires).length,
			segments: segments.length,
			netflags: asArray(snap.netflags).length,
			texts: asArray(snap.texts).length,
			visibleObjects: objects.length,
		},
		findings,
	};
}

export { validateProjectGeometry };

function main() {
	const findings = [];
	let snap = null;
	if (!existsSync(SOURCE)) {
		hard(findings, 'PG0-source-file', `${SOURCE_LABEL} is required before project geometry audit`, { path: SOURCE });
	} else {
		try { snap = readJson(SOURCE); }
		catch (e) { hard(findings, 'PG0-source-parse', `${SOURCE_LABEL} must parse as JSON`, { path: SOURCE, error: e.message }); }
	}
	const result = snap ? validateProjectGeometry(snap, { liveMode: RUN_LIVE }) : {
		pass: false,
		severity: { hard: findings.length, soft: 0, info: 0 },
		stats: null,
		findings,
	};
	const allFindings = [...findings, ...asArray(result.findings)];
	const report = {
		generatedAt: new Date().toISOString(),
		pass: allFindings.length === 0,
		severity: { hard: allFindings.length, soft: 0, info: 0 },
		source: SOURCE_LABEL,
		stats: result.stats,
		findings: allFindings,
	};
	writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
	console.log(`project geometry ${report.pass ? 'PASS' : 'FAIL'} source=${SOURCE_LABEL} hard=${report.severity.hard}`);
	console.log(`report -> ${REPORT}`);
	process.exit(report.pass ? 0 : 1);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/project_geometry_gate.mjs')) main();

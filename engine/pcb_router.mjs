// Generic two-layer PCB escape/router. Circuit-specific net priorities and widths
// belong in the caller's policy; this module only consumes measured pad geometry.

const SQRT2 = Math.SQRT2;
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

class Heap {
	constructor() { this.items = []; }
	push(item) { const a = this.items; a.push(item); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].f <= item.f) break; a[i] = a[p]; i = p; } a[i] = item; }
	pop() { const a = this.items; if (!a.length) return null; const root = a[0], last = a.pop(); if (a.length) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= a.length) break; if (c + 1 < a.length && a[c + 1].f < a[c].f) c++; if (a[c].f >= last.f) break; a[i] = a[c]; i = c; } a[i] = last; } return root; }
	get length() { return this.items.length; }
}

const key = (x, y, layer, dir) => `${x},${y},${layer},${dir}`;
const pointSegDistance = (x, y, a, b) => {
	const dx = b.x - a.x, dy = b.y - a.y;
	if (!dx && !dy) return Math.hypot(x - a.x, y - a.y);
	const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
	return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
};

class Obstacles {
	constructor(pads, bucketMil = 100, maxExpansionMil = 60) {
		this.bucketMil = bucketMil; this.maxExpansionMil = maxExpansionMil; this.map = new Map();
		for (const pad of pads) this.add({ kind: 'pad', ...pad }, pad.bbox);
	}
	bucket(x, y) { return `${Math.floor(x / this.bucketMil)},${Math.floor(y / this.bucketMil)}`; }
	add(item, bbox) {
		const e = this.maxExpansionMil;
		for (let bx = Math.floor((bbox.minX - e) / this.bucketMil); bx <= Math.floor((bbox.maxX + e) / this.bucketMil); bx++)
			for (let by = Math.floor((bbox.minY - e) / this.bucketMil); by <= Math.floor((bbox.maxY + e) / this.bucketMil); by++) {
				const k = `${bx},${by}`, list = this.map.get(k) || []; list.push(item); this.map.set(k, list);
			}
	}
	addTrack(track) {
		const bbox = { minX: Math.min(track.a.x, track.b.x), minY: Math.min(track.a.y, track.b.y), maxX: Math.max(track.a.x, track.b.x), maxY: Math.max(track.a.y, track.b.y) };
		this.add({ kind: 'track', ...track }, bbox);
	}
	addVia(via) {
		const r = via.diameter / 2, bbox = { minX: via.x - r, minY: via.y - r, maxX: via.x + r, maxY: via.y + r };
		this.add({ kind: 'via', ...via }, bbox);
	}
	blocked(x, y, layer, net, width, clearance) {
		for (const item of this.map.get(this.bucket(x, y)) || []) {
			if (item.net === net) continue;
			if (item.kind === 'pad') {
				const through = Array.isArray(item.hole) && Math.max(...item.hole.slice(1).map(Number).filter(Number.isFinite), 0) > 5;
				if (layer !== item.layer && !through) continue;
				const e = clearance + width / 2;
				if (x > item.bbox.minX - e && x < item.bbox.maxX + e && y > item.bbox.minY - e && y < item.bbox.maxY + e) return true;
			} else if (item.kind === 'track' && item.layer === layer) {
				if (pointSegDistance(x, y, item.a, item.b) < clearance + (width + item.width) / 2) return true;
			} else if (item.kind === 'via') {
				if (Math.hypot(x - item.x, y - item.y) < clearance + width / 2 + item.diameter / 2) return true;
			}
		}
		return false;
	}
	segmentBlocked(a, b, layer, net, width, clearance, sampleMil = 2) {
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const steps = Math.max(1, Math.ceil(length / sampleMil));
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			if (this.blocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, layer, net, width, clearance)) return true;
		}
		return false;
	}
}

function snap(value, grid) { return Math.round(value / grid) * grid; }
function octile(ax, ay, bx, by, step) { const dx = Math.abs(ax - bx), dy = Math.abs(ay - by); return step * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)); }

function findPath(start, goal, ctx) {
	const { grid, board, obstacles, net, width, clearance, viaCost, bendCost, maxExpansions } = ctx;
	const minIx = Math.ceil((board.minX + ctx.edgeClearance) / grid), maxIx = Math.floor((board.maxX - ctx.edgeClearance) / grid);
	const minIy = Math.ceil((board.minY + ctx.edgeClearance) / grid), maxIy = Math.floor((board.maxY - ctx.edgeClearance) / grid);
	const sx = Math.round(start.x / grid), sy = Math.round(start.y / grid), gx = Math.round(goal.x / grid), gy = Math.round(goal.y / grid);
	if (obstacles.blocked(sx * grid, sy * grid, ctx.startLayer ?? 1, net, width, clearance)) {
		if (ctx.diagnostics) ctx.diagnostics.reason = 'start-blocked';
		return null;
	}
	if (obstacles.blocked(gx * grid, gy * grid, ctx.endLayer ?? 1, net, width, clearance)) {
		if (ctx.diagnostics) ctx.diagnostics.reason = 'goal-blocked';
		return null;
	}
	const open = new Heap(), best = new Map(), parent = new Map();
	const startLayer = ctx.startLayer ?? 1, endLayer = ctx.endLayer ?? 1;
	const allowedLayers = new Set(ctx.allowedLayers || [1, 2]);
	const initial = { x: sx, y: sy, layer: startLayer, dir: 8, g: 0, f: octile(sx, sy, gx, gy, grid) };
	open.push(initial); best.set(key(sx, sy, startLayer, 8), 0);
	let end = null, expanded = 0;
	while (open.length && expanded++ < maxExpansions) {
		const cur = open.pop(), ck = key(cur.x, cur.y, cur.layer, cur.dir);
		if (cur.g !== best.get(ck)) continue;
		if (cur.x === gx && cur.y === gy && cur.layer === endLayer) { end = cur; break; }
		for (let dir = 0; dir < DIRS.length; dir++) {
			if (cur.dir < 8) {
				const turn = Math.min(Math.abs(cur.dir - dir), 8 - Math.abs(cur.dir - dir));
				if (turn > 1) continue;
			}
			const [dx, dy] = DIRS[dir], nx = cur.x + dx, ny = cur.y + dy;
			if (nx < minIx || nx > maxIx || ny < minIy || ny > maxIy) continue;
			const x = nx * grid, y = ny * grid, mx = (cur.x + nx) * grid / 2, my = (cur.y + ny) * grid / 2;
			if (obstacles.blocked(x, y, cur.layer, net, width, clearance) || obstacles.blocked(mx, my, cur.layer, net, width, clearance)) continue;
			const preferredAxis = ctx.preferredAxisByLayer?.[cur.layer];
			const moveAxis = dx && dy ? 'diagonal' : (dx ? 'x' : 'y');
			const directionPenalty = preferredAxis && moveAxis !== preferredAxis
				? (ctx.wrongWayCost ?? 0) * (moveAxis === 'diagonal' ? 0.35 : 1) : 0;
			const stepCost = grid * (dx && dy ? SQRT2 : 1) * (cur.layer === 2 ? 1.06 : 1)
				+ directionPenalty + (cur.dir < 8 && cur.dir !== dir ? bendCost : 0);
			const ng = cur.g + stepCost, nk = key(nx, ny, cur.layer, dir);
			if (ng + 1e-9 >= (best.get(nk) ?? Infinity)) continue;
			best.set(nk, ng); parent.set(nk, ck); open.push({ x: nx, y: ny, layer: cur.layer, dir, g: ng, f: ng + octile(nx, ny, gx, gy, grid) });
		}
		const distFromEnds = Math.min(Math.hypot(cur.x - sx, cur.y - sy), Math.hypot(cur.x - gx, cur.y - gy)) * grid;
		if (allowedLayers.size > 1 && distFromEnds >= ctx.viaKeepout) {
			const other = cur.layer === 1 ? 2 : 1, x = cur.x * grid, y = cur.y * grid;
			if (allowedLayers.has(other)
				&& !obstacles.blocked(x, y, 1, net, ctx.viaDiameter, clearance)
				&& !obstacles.blocked(x, y, 2, net, ctx.viaDiameter, clearance)) {
				const ng = cur.g + viaCost, nk = key(cur.x, cur.y, other, 8);
				if (ng < (best.get(nk) ?? Infinity)) { best.set(nk, ng); parent.set(nk, ck); open.push({ x: cur.x, y: cur.y, layer: other, dir: 8, g: ng, f: ng + octile(cur.x, cur.y, gx, gy, grid) }); }
			}
		}
	}
	if (!end) {
		if (ctx.diagnostics) Object.assign(ctx.diagnostics, { reason: expanded >= maxExpansions ? 'search-limit' : 'no-path', expanded });
		return null;
	}
	const nodes = []; let cursor = key(end.x, end.y, end.layer, end.dir);
	while (cursor) { const [x, y, layer, dir] = cursor.split(',').map(Number); nodes.push({ x: x * grid, y: y * grid, layer, dir }); cursor = parent.get(cursor); }
	return nodes.reverse();
}

function terminalSide(pad) {
	const component = pad.componentBBox;
	if (!component) return 'right';
	const cx = (component.minX + component.maxX) / 2, cy = (component.minY + component.maxY) / 2;
	const halfW = Math.max((component.maxX - component.minX) / 2, 1);
	const halfH = Math.max((component.maxY - component.minY) / 2, 1);
	const nx = (pad.x - cx) / halfW, ny = (pad.y - cy) / halfH;
	// Component bboxes often end at the pad copper on several sides at once.
	// The normalized pad-center vector identifies the real escape side for those
	// footprints (for example, a horizontal chip resistor's left/right pads).
	if (Math.max(Math.abs(nx), Math.abs(ny)) > 0.18)
		return Math.abs(nx) >= Math.abs(ny) ? (nx < 0 ? 'left' : 'right') : (ny < 0 ? 'bottom' : 'top');
	const distances = [
		['left', Math.abs(pad.bbox.minX - component.minX)],
		['right', Math.abs(component.maxX - pad.bbox.maxX)],
		['bottom', Math.abs(pad.bbox.minY - component.minY)],
		['top', Math.abs(component.maxY - pad.bbox.maxY)],
	];
	return distances.sort((a, b) => a[1] - b[1])[0][0];
}

function terminalEscape(pad, { board, width, clearance, grid, margin = 8 }) {
	const side = arguments[1].side || terminalSide(pad), component = pad.componentBBox || pad.bbox;
	const offset = clearance + width / 2 + margin;
	const exit = { x: pad.x, y: pad.y };
	if (side === 'left') exit.x = component.minX - offset;
	if (side === 'right') exit.x = component.maxX + offset;
	if (side === 'bottom') exit.y = component.minY - offset;
	if (side === 'top') exit.y = component.maxY + offset;
	const point = { x: snap(exit.x, grid), y: snap(exit.y, grid) };
	// Keep the grid point farther out than its lateral snap error. This makes the
	// exact pad escape a straight + 45-degree pair instead of a 90-degree dogleg.
	if (side === 'top') point.y = snap(Math.max(point.y, exit.y + Math.abs(point.x - exit.x)), grid);
	if (side === 'bottom') point.y = snap(Math.min(point.y, exit.y - Math.abs(point.x - exit.x)), grid);
	if (side === 'right') point.x = snap(Math.max(point.x, exit.x + Math.abs(point.y - exit.y)), grid);
	if (side === 'left') point.x = snap(Math.min(point.x, exit.x - Math.abs(point.y - exit.y)), grid);
	point.x = Math.max(board.minX, Math.min(board.maxX, point.x));
	point.y = Math.max(board.minY, Math.min(board.maxY, point.y));
	return { side, exit, point };
}

function octilinearBetween(a, b, preferAxis = '') {
	const dx = b.x - a.x, dy = b.y - a.y;
	if (!dx || !dy || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-9) return [a, b];
	if (preferAxis === 'x' || (!preferAxis && Math.abs(dx) >= Math.abs(dy))) {
		const q = { x: a.x + Math.sign(dx) * Math.abs(dy), y: b.y };
		return [a, q, b];
	}
	const q = { x: b.x, y: a.y + Math.sign(dy) * Math.abs(dx) };
	return [a, q, b];
}

function escapeNodes(pad, ctx) {
	const escape = terminalEscape(pad, ctx);
	const outwardAxis = escape.side === 'left' || escape.side === 'right' ? 'x' : 'y';
	const tail = octilinearBetween(escape.exit, escape.point, outwardAxis);
	return simplify([{ x: pad.x, y: pad.y, layer: 1 }, ...tail.map(point => ({ ...point, layer: 1 }))]);
}

function escapeCandidates(pad, other, ctx, obstacles, net) {
	const preferred = terminalSide(pad);
	const dx = other.x - pad.x, dy = other.y - pad.y;
	const toward = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'bottom' : 'top');
	const perpendicular = preferred === 'left' || preferred === 'right' ? ['top', 'bottom'] : ['left', 'right'];
	const order = [...new Set([preferred, toward, ...perpendicular, 'left', 'right', 'top', 'bottom'])];
	const candidates = [];
	for (const side of order) {
		const nodes = escapeNodes(pad, { ...ctx, side });
		if (!clearOctilinearCandidate(nodes, obstacles, net, ctx.width, ctx.clearance)) continue;
		const end = nodes.at(-1);
		if (obstacles.blocked(end.x, end.y, 1, net, ctx.width, ctx.clearance)) continue;
		candidates.push(nodes);
	}
	return candidates;
}

function clearOctilinearCandidate(points, obstacles, net, width, clearance) {
	for (let i = 1; i < points.length; i++)
		if (obstacles.segmentBlocked(points[i - 1], points[i], 1, net, width, clearance)) return false;
	return true;
}

function directPadPath(a, b, obstacles, net, width, clearance) {
	const start = { x: a.x, y: a.y, layer: 1 }, end = { x: b.x, y: b.y, layer: 1 };
	for (const axis of ['x', 'y']) {
		const points = simplify(octilinearBetween(start, end, axis).map(point => ({ ...point, layer: 1 })));
		if (clearOctilinearCandidate(points, obstacles, net, width, clearance)) return points;
	}
	return null;
}

function simplify(nodes) {
	const out = [];
	for (const node of nodes) {
		const p = out.at(-1), q = out.at(-2);
		if (p && p.x === node.x && p.y === node.y && p.layer === node.layer) continue;
		if (q && p.layer === node.layer && q.layer === p.layer) {
			const ax = p.x - q.x, ay = p.y - q.y, bx = node.x - p.x, by = node.y - p.y;
			if (ax * by === ay * bx && Math.sign(ax) === Math.sign(bx) && Math.sign(ay) === Math.sign(by)) { out[out.length - 1] = node; continue; }
		}
		out.push(node);
	}
	return out;
}

function mst(terminals) {
	if (terminals.length < 2) return [];
	const used = new Set([0]), edges = [];
	while (used.size < terminals.length) {
		let best = null;
		for (const a of used) for (let b = 0; b < terminals.length; b++) if (!used.has(b)) {
			const d = Math.hypot(terminals[a].x - terminals[b].x, terminals[a].y - terminals[b].y);
			if (!best || d < best.d) best = { a, b, d };
		}
		edges.push(best); used.add(best.b);
	}
	return edges;
}

function segmentsFromNodes(nodes, net, width, viaSpec) {
	const segments = [], vias = [];
	for (let i = 1; i < nodes.length; i++) {
		const a = nodes[i - 1], b = nodes[i];
		if (a.layer !== b.layer) { vias.push({ net, x: a.x, y: a.y, ...viaSpec }); continue; }
		if (a.x !== b.x || a.y !== b.y) segments.push({ net, layer: a.layer, width, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
	}
	return { segments, vias };
}

export function planPcbRoutes(snapshot, policy = {}) {
	const board = snapshot.board?.bbox;
	if (!board) throw new Error('PCB router requires a measured board bbox');
	const pads = [];
	for (const component of snapshot.components || []) for (const pad of component.pads || []) if (pad.bbox)
		pads.push({ ...pad, ref: component.ref, componentBBox: component.bbox });
	const ignored = new Set(policy.ignoreNets || []), byNet = new Map();
	for (const pad of pads) if (pad.net && !ignored.has(pad.net)) { const list = byNet.get(pad.net) || []; list.push(pad); byNet.set(pad.net, list); }
	const order = [...new Set([...(policy.netOrder || []), ...[...byNet.keys()].sort()])].filter(net => (byNet.get(net) || []).length > 1);
	const obstacles = new Obstacles(pads, policy.bucketMil ?? 100, policy.maxObstacleExpansionMil ?? 80);
	const result = { segments: [], vias: [], failed: [], nets: [] };
	for (const net of order) {
		const terminals = byNet.get(net), width = policy.widthByNet?.[net] ?? policy.defaultWidthMil ?? 10;
		const viaSpec = width >= (policy.powerWidthThresholdMil ?? 18) ? (policy.powerVia || { holeDiameter: 16, diameter: 32 }) : (policy.signalVia || { holeDiameter: 12, diameter: 24 });
		const netResult = { net, width, terminals: terminals.length, connections: 0, segments: 0, vias: 0 };
		for (const edge of mst(terminals)) {
			const a = terminals[edge.a], b = terminals[edge.b], grid = policy.gridMil ?? 5;
			const clearance = policy.clearanceMil ?? 8;
			const direct = directPadPath(a, b, obstacles, net, width, clearance);
			if (direct) {
				const made = segmentsFromNodes(direct, net, width, viaSpec);
				for (const segment of made.segments) { result.segments.push(segment); obstacles.addTrack(segment); }
				netResult.connections++; netResult.segments += made.segments.length;
				continue;
			}
			const escapeCtx = { board, width, clearance, grid, margin: policy.padEscapeMarginMil ?? 8 };
			const aCandidates = escapeCandidates(a, b, escapeCtx, obstacles, net);
			const bCandidates = escapeCandidates(b, a, escapeCtx, obstacles, net);
			const allowedLayers = policy.allowedLayersByNet?.[net] || policy.allowedLayers || [1, 2];
			const diagnostics = {}; let nodes = null, aEscape = null, bEscape = null;
			for (const aCandidate of aCandidates) {
				for (const bCandidate of bCandidates) {
					const attempt = {};
					const found = findPath(aCandidate.at(-1), bCandidate.at(-1), {
						grid, board, obstacles, net, width, allowedLayers,
						clearance, edgeClearance: policy.edgeClearanceMil ?? 12,
						viaCost: policy.viaCostMil ?? 80, bendCost: policy.bendCostMil ?? 3,
						viaKeepout: policy.viaKeepoutMil ?? 25, viaDiameter: viaSpec.diameter,
						preferredAxisByLayer: policy.preferredAxisByLayer,
						wrongWayCost: policy.wrongWayCostMil ?? 0,
						maxExpansions: policy.maxExpansions ?? 180000,
						diagnostics: attempt,
					});
					Object.assign(diagnostics, attempt);
					if (found) { nodes = found; aEscape = aCandidate; bEscape = bCandidate; break; }
				}
				if (nodes) break;
			}
			if (!nodes) { result.failed.push({ net, from: `${a.ref}_${a.number}`, to: `${b.ref}_${b.number}`, reason: diagnostics.reason || 'no-path' }); continue; }
			const bTail = [...bEscape].reverse();
			nodes = simplify([...aEscape, ...nodes.slice(1, -1), ...bTail]);
			const made = segmentsFromNodes(nodes, net, width, viaSpec);
			for (const segment of made.segments) { result.segments.push(segment); obstacles.addTrack(segment); }
			for (const via of made.vias) { result.vias.push(via); obstacles.addVia(via); }
			netResult.connections++; netResult.segments += made.segments.length; netResult.vias += made.vias.length;
		}
		result.nets.push(netResult);
	}
	return result;
}

export function auditPcbRouteAngles(plan, tolerance = 1e-6) {
	const bad = [];
	for (const segment of plan.segments || []) {
		const dx = Math.abs(segment.b.x - segment.a.x), dy = Math.abs(segment.b.y - segment.a.y);
		if (dx > tolerance && dy > tolerance && Math.abs(dx - dy) > tolerance) bad.push(segment);
	}
	return bad;
}

export function auditPcbRouteBends(plan, {
	coordinateToleranceMil = 0.15,
	maxTurnDegrees = 45,
	angleToleranceDegrees = 1,
} = {}) {
	const groups = new Map();
	const pointKey = point => `${Math.round(point.x / coordinateToleranceMil)},${Math.round(point.y / coordinateToleranceMil)}`;
	for (const segment of plan.segments || []) {
		for (const [point, other] of [[segment.a, segment.b], [segment.b, segment.a]]) {
			const group = `${segment.net || ''}|${segment.layer}|${pointKey(point)}`;
			const arms = groups.get(group) || [];
			arms.push({ segment, point, vector: { x: other.x - point.x, y: other.y - point.y } });
			groups.set(group, arms);
		}
	}
	const bad = [];
	for (const [group, arms] of groups) {
		if (arms.length !== 2) continue;
		const [a, b] = arms, al = Math.hypot(a.vector.x, a.vector.y), bl = Math.hypot(b.vector.x, b.vector.y);
		if (al <= coordinateToleranceMil || bl <= coordinateToleranceMil) continue;
		const cosine = Math.max(-1, Math.min(1, (a.vector.x * b.vector.x + a.vector.y * b.vector.y) / (al * bl)));
		const included = Math.acos(cosine) * 180 / Math.PI;
		const turnDegrees = Math.abs(180 - included);
		if (turnDegrees > maxTurnDegrees + angleToleranceDegrees)
			bad.push({ group, turnDegrees, segments: [a.segment, b.segment] });
	}
	return bad;
}

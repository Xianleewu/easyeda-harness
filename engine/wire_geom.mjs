export const ptKey = (x, y) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;

export function wireSegments(wires) {
	const out = [];
	let id = 0;
	for (const w of wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const line = [l[i], l[i + 1], l[i + 2], l[i + 3]];
			if (line[0] === line[2] && line[1] === line[3]) continue;
			out.push({ id: id++, net: w.net || '', line, wire: w });
		}
	}
	return out;
}

export function between(v, a, b) {
	return v >= Math.min(a, b) - 1e-6 && v <= Math.max(a, b) + 1e-6;
}

export function pointOnSegment(x, y, s) {
	const [x1, y1, x2, y2] = s.line;
	if (Math.abs(x1 - x2) < 1e-6) return Math.abs(x - x1) < 1e-6 && between(y, y1, y2);
	if (Math.abs(y1 - y2) < 1e-6) return Math.abs(y - y1) < 1e-6 && between(x, x1, x2);
	return false;
}

export function orthogonalTouch(a, b) {
	const A = a.line, B = b.line;
	for (const [x, y] of [[A[0], A[1]], [A[2], A[3]]]) if (pointOnSegment(x, y, b)) return true;
	for (const [x, y] of [[B[0], B[1]], [B[2], B[3]]]) if (pointOnSegment(x, y, a)) return true;
	const ah = Math.abs(A[1] - A[3]) < 1e-6;
	const av = Math.abs(A[0] - A[2]) < 1e-6;
	const bh = Math.abs(B[1] - B[3]) < 1e-6;
	const bv = Math.abs(B[0] - B[2]) < 1e-6;
	if (ah && bv) return between(B[0], A[0], A[2]) && between(A[1], B[1], B[3]);
	if (av && bh) return between(A[0], B[0], B[2]) && between(B[1], A[1], A[3]);
	return false;
}

export function endpointTouch(a, b) {
	const A = a.line, B = b.line;
	for (const [x, y] of [[A[0], A[1]], [A[2], A[3]]]) if (pointOnSegment(x, y, b)) return true;
	for (const [x, y] of [[B[0], B[1]], [B[2], B[3]]]) if (pointOnSegment(x, y, a)) return true;
	return false;
}

export function physicalWireRoots(wires) {
	const segments = wireSegments(wires);
	const parent = new Map();
	const add = k => { if (!parent.has(k)) parent.set(k, k); };
	const find = k => { add(k); while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
	const union = (a, b) => parent.set(find(a), find(b));
	for (const s of segments) {
		add(String(s.id));
		union(ptKey(s.line[0], s.line[1]), ptKey(s.line[2], s.line[3]));
	}
	for (let i = 0; i < segments.length; i++) {
		for (let j = i + 1; j < segments.length; j++) {
			if (endpointTouch(segments[i], segments[j])) union(String(segments[i].id), String(segments[j].id));
		}
	}
	const groups = new Map();
	for (const s of segments) {
		const root = find(String(s.id));
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root).push(s);
	}
	return { segments, groups, find };
}

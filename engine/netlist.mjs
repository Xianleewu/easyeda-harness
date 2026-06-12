import { endpointTouch, wireSegments } from './wire_geom.mjs';

const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;

class UF {
	constructor() { this.parent = new Map(); }
	add(k) { if (!this.parent.has(k)) this.parent.set(k, k); }
	find(k) {
		this.add(k);
		while (this.parent.get(k) !== k) {
			this.parent.set(k, this.parent.get(this.parent.get(k)));
			k = this.parent.get(k);
		}
		return k;
	}
	union(a, b) {
		this.parent.set(this.find(a), this.find(b));
	}
}

export function buildNetlist(model) {
	const uf = new UF();
	const segments = wireSegments(model.wires);

	for (const s of segments) {
		uf.union(key(s.line[0], s.line[1]), key(s.line[2], s.line[3]));
	}
	for (let i = 0; i < segments.length; i++) {
		for (let j = i + 1; j < segments.length; j++) {
			if (endpointTouch(segments[i], segments[j])) {
				uf.union(key(segments[i].line[0], segments[i].line[1]), key(segments[j].line[0], segments[j].line[1]));
			}
		}
	}

	for (const c of model.components || []) {
		if (c.designator !== 'R11' && c.designator !== 'R12') continue;
		const ps = c.pins || [];
		if (ps.length === 2) uf.union(key(ps[0].x, ps[0].y), key(ps[1].x, ps[1].y));
	}

	const pinNodes = [];
	for (const c of model.components || []) {
		for (const p of c.pins || []) {
			const k = key(p.x, p.y);
			uf.add(k);
			pinNodes.push({ ref: `${c.designator}.${p.num}`, name: p.name, x: p.x, y: p.y, rot: p.rot, designator: c.designator, k });
		}
	}

	const flagNodes = [];
	for (const n of model.netflags || []) {
		const k = key(n.x, n.y);
		uf.add(k);
		flagNodes.push({ ...n, k });
	}

	const groupName = new Map();
	function nameRoot(root, net) {
		if (!net) return;
		if (groupName.has(root) && groupName.get(root) !== net) groupName.set(root, `${groupName.get(root)}|${net}`);
		else groupName.set(root, net);
	}
	for (const f of flagNodes) nameRoot(uf.find(f.k), f.net);
	for (const w of model.wires || []) {
		if (!w.net) continue;
		const segs = wireSegments([w]);
		if (!segs.length) continue;
		nameRoot(uf.find(key(segs[0].line[0], segs[0].line[1])), w.net);
	}

	const nameToRoot = new Map();
	for (const [r, nm] of groupName) {
		if (nameToRoot.has(nm)) uf.union(r, nameToRoot.get(nm));
		else nameToRoot.set(nm, r);
	}

	const mergedGroupName = new Map();
	for (const [r, nm] of groupName) {
		const root = uf.find(r);
		if (mergedGroupName.has(root) && mergedGroupName.get(root) !== nm) mergedGroupName.set(root, `${mergedGroupName.get(root)}|${nm}`);
		else mergedGroupName.set(root, nm);
	}

	const nets = new Map();
	const getNet = r => {
		if (!nets.has(r)) nets.set(r, { name: null, pins: [], flags: [] });
		return nets.get(r);
	};
	for (const f of flagNodes) {
		const n = getNet(uf.find(f.k));
		if (f.net) n.name = n.name || f.net;
		n.flags.push(f);
	}
	for (const p of pinNodes) getNet(uf.find(p.k)).pins.push(p);
	for (const [root, nm] of mergedGroupName) {
		if (nets.has(root)) nets.get(root).name = nets.get(root).name || nm;
	}

	const result = [...nets.values()].filter(n => n.pins.length || n.flags.length);
	let anon = 0;
	for (const n of result) if (!n.name) n.name = `N$${++anon}`;
	return result;
}

export function netlistStats(nets) {
	const single = nets.filter(n => n.pins.length === 1);
	const lines = [];
	lines.push(`nets=${nets.length}  single-pin=${single.length}`);
	for (const n of nets.sort((a, b) => b.pins.length - a.pins.length)) {
		lines.push(`  [${n.name}] pins=${n.pins.length} flags=${n.flags.length}: ${n.pins.map(p => p.ref).join(' ')}`);
	}
	return lines.join('\n');
}

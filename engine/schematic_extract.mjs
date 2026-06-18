// 从快照几何重建网表(纯函数)：引脚↔网标↔导线连通性聚类 → 逻辑模型。
// 丢弃所有摆放坐标，只留逻辑(器件+网表+电源/地/信号分类)，供角色推断与合成。

const TOL = 1;
const r1 = v => Math.round(v);

const GROUND_RE = /^(GND|VSS|AGND|DGND|PGND|VEE|GROUND)$/i;
const POWER_RE = /(VCC|VDD|VBAT|VBUS|VIN|VOUT|AVDD|DVDD|PWR|VSYS|\d+V\d*|V\d+$|\d*V3$|\d*V5$)/i;

const KIND = [
	[/^LED/i, 'led'], [/^R/i, 'resistor'], [/^C/i, 'capacitor'], [/^L/i, 'inductor'],
	[/^D/i, 'diode'], [/^Q/i, 'transistor'], [/^(U|IC)/i, 'ic'], [/^(J|CN|P)/i, 'connector'],
	[/^SW/i, 'switch'], [/^S/i, 'switch'], [/^TP/i, 'testpoint'], [/^(Y|X)/i, 'crystal'], [/^FB/i, 'ferrite'],
];

function kindOf(designator) {
	const m = String(designator || '').match(/^[A-Za-z]+/);
	const prefix = m ? m[0] : '';
	for (const [re, k] of KIND) if (re.test(prefix)) return k;
	return 'other';
}

function classOf(name, hasGroundFlag, hasPowerFlag) {
	if (hasGroundFlag || GROUND_RE.test(name)) return 'ground';
	if (hasPowerFlag || POWER_RE.test(name)) return 'power';
	return 'signal';
}

export function extractLogical(snapshot) {
	const comps = snapshot.components || [];
	const wires = snapshot.wires || [];
	const flags = snapshot.netflags || [];

	// 节点 + 坐标索引
	const par = new Map();
	const find = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
	const add = x => { if (!par.has(x)) par.set(x, x); };
	const uni = (a, b) => { add(a); add(b); par.set(find(a), find(b)); };

	const coord = new Map(); // key -> [node]
	const at = (x, y) => `${r1(x)},${r1(y)}`;
	const indexNode = (node, x, y) => { const k = at(x, y); if (!coord.has(k)) coord.set(k, []); coord.get(k).push(node); add(node); };

	const pinRef = new Map(); // node -> 'REF.PIN'
	comps.forEach(c => (c.pins || []).forEach(p => {
		const node = `P:${c.designator}.${p.num}`;
		pinRef.set(node, `${c.designator}.${p.num}`);
		indexNode(node, p.x, p.y);
	}));
	const flagNet = new Map(); // node -> {net, ground, power}
	flags.forEach((f, i) => {
		const node = `F:${i}`;
		flagNet.set(node, { net: f.net || '', ground: /ground/i.test(f.symbol || ''), power: /power/i.test(f.symbol || '') });
		indexNode(node, f.x, f.y);
	});

	// 重合终端互连
	for (const nodes of coord.values()) for (let i = 1; i < nodes.length; i++) uni(nodes[0], nodes[i]);

	// 导线顶点：连接其上的终端，并连接共享顶点的导线
	const wireAtVertex = new Map();
	const wireNet = new Map(); // node -> net 名
	const wireVerts = new Map(); // node -> [[x,y],...]
	const segs = []; // [ax,ay,bx,by,node] 所有线段(用于 T 型 junction)
	wires.forEach(w => {
		const node = `W:${w.id}`;
		add(node);
		wireNet.set(node, w.net || '');
		const line = w.line || [];
		const verts = [];
		for (let i = 0; i + 1 < line.length; i += 2) {
			for (let dx = -TOL; dx <= TOL; dx++) for (let dy = -TOL; dy <= TOL; dy++) {
				const k = at(line[i] + dx, line[i + 1] + dy);
				for (const t of coord.get(k) || []) uni(node, t);
			}
			const vk = at(line[i], line[i + 1]);
			if (!wireAtVertex.has(vk)) wireAtVertex.set(vk, []);
			wireAtVertex.get(vk).push(node);
			verts.push([line[i], line[i + 1]]);
			if (i >= 2) segs.push([line[i - 2], line[i - 1], line[i], line[i + 1], node]);
		}
		wireVerts.set(node, verts);
	});
	for (const ws of wireAtVertex.values()) for (let i = 1; i < ws.length; i++) uni(ws[0], ws[i]);

	// T 型 junction:一条线的顶点落在另一条线段内部(非端点)→ 互连。
	// 仅当点严格在段内(共线 + 投影参数 ∈(0,1) + 偏离 ≤TOL),避免共线断开两线误并。
	const onSeg = (px, py, ax, ay, bx, by) => {
		const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
		if (Math.abs(cross) > TOL * Math.hypot(bx - ax, by - ay)) return false;
		const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
		if (len2 === 0) return false;
		const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2;
		return t > 1e-6 && t < 1 - 1e-6;
	};
	for (const [node, verts] of wireVerts) {
		for (const [px, py] of verts) {
			for (const [ax, ay, bx, by, snode] of segs) {
				if (snode === node) continue;
				if (find(snode) === find(node)) continue;
				if (onSeg(px, py, ax, ay, bx, by)) uni(node, snode);
			}
		}
	}

	// 物理聚类:逐根收 pins/flags/wire 名/是否有导线
	const groups = new Map();
	const groupOf = root => { if (!groups.has(root)) groups.set(root, { pins: [], flags: [], wireNames: [], hasWire: false }); return groups.get(root); };
	for (const node of par.keys()) {
		const root = find(node);
		if (pinRef.has(node)) groupOf(root).pins.push(pinRef.get(node));
		else if (flagNet.has(node)) groupOf(root).flags.push(flagNet.get(node));
		else if (wireNet.has(node)) { const g = groupOf(root); g.hasWire = true; if (wireNet.get(node)) g.wireNames.push(wireNet.get(node)); }
	}

	// 按网名合并跨物理簇(命名网靠名连接);无名簇各自独立
	let auto = 0;
	let floatingPins = 0;
	const byName = new Map(); // 真实网名 -> 合并网
	const anon = [];
	for (const g of groups.values()) {
		if (!g.pins.length && !g.flags.length) continue; // 纯导线簇跳过
		const named = g.flags.find(f => f.net)?.net || g.wireNames[0] || '';
		const ground = g.flags.some(f => f.ground);
		const power = g.flags.some(f => f.power);
		if (g.pins.length === 1 && !g.flags.length && !g.hasWire) floatingPins++;
		if (named) {
			if (!byName.has(named)) byName.set(named, { name: named, ground: false, power: false, pins: new Set() });
			const m = byName.get(named);
			m.ground ||= ground; m.power ||= power;
			for (const p of g.pins) m.pins.add(p);
		} else {
			anon.push({ name: `N$${++auto}`, class: classOf('', ground, power), pins: g.pins.slice().sort() });
		}
	}
	const nets = [
		...[...byName.values()].map(m => ({ name: m.name, class: classOf(m.name, m.ground, m.power), pins: [...m.pins].sort() })),
		...anon,
	];

	const parts = comps.map(c => ({
		ref: c.designator, kind: kindOf(c.designator),
		value: c.value || (c.otherProperty && c.otherProperty.Value) || null,
		pinCount: (c.pins || []).length,
	}));

	const stats = {
		parts: parts.length, nets: nets.length,
		powerNets: nets.filter(n => n.class === 'power').length,
		groundNets: nets.filter(n => n.class === 'ground').length,
		signalNets: nets.filter(n => n.class === 'signal').length,
		floatingPins,
	};
	return { parts, nets, stats };
}

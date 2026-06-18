// 角色推断 + 模块聚类(纯函数)。输入 extractLogical 的逻辑模型。
//
// 角色 → 决定信号流列(连接器/电源左、控制器中、负载右)与 cell 原型映射。
// 模块 → 按信号网聚类(排除电源/地网与控制器枢纽，否则星形拓扑会把全图并成一团)。

const refOfPin = p => p.slice(0, p.lastIndexOf('.'));

function pickController(parts) {
	const ics = parts.filter(p => p.kind === 'ic');
	if (!ics.length) return null;
	return ics.reduce((a, b) => (b.pinCount > a.pinCount ? b : a)).ref;
}

/* 每个器件触及的网(按 class 计数) */
function partNetIndex(parts, nets) {
	const touch = new Map(parts.map(p => [p.ref, { power: 0, ground: 0, signal: new Set() }]));
	nets.forEach((n, i) => {
		const refs = new Set(n.pins.map(refOfPin));
		for (const ref of refs) {
			const t = touch.get(ref);
			if (!t) continue;
			if (n.class === 'power') t.power++;
			else if (n.class === 'ground') t.ground++;
			else t.signal.add(i);
		}
	});
	return touch;
}

function roleOf(part, controller, touch) {
	if (part.ref === controller) return 'controller';
	switch (part.kind) {
		case 'connector': return 'connector';
		case 'testpoint': return 'testpoint';
		case 'switch': return 'input';
		case 'transistor': return 'switch';
		case 'led': case 'diode': return 'indicator';
		case 'resistor': case 'capacitor': case 'inductor': case 'crystal': case 'ferrite': return 'support';
		case 'ic': {
			// regulator 判据 = 触及 ≥2 个 power 网(同时有输入+输出电源轨,即"产生电源")。
			// 旧判 power+ground>=2 会把单电源轨负载(VDD+GND)误判稳压器 → 错列到电源列。
			const t = touch.get(part.ref);
			return (t && t.power >= 2) ? 'regulator' : 'ic';
		}
		default: return 'other';
	}
}

function clusterModules(parts, nets, controller) {
	const refs = parts.map(p => p.ref).filter(r => r !== controller);
	const par = new Map(refs.map(r => [r, r]));
	const find = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
	const uni = (a, b) => { if (par.has(a) && par.has(b)) par.set(find(a), find(b)); };

	for (const n of nets) {
		if (n.class !== 'signal') continue;
		const ps = [...new Set(n.pins.map(refOfPin))].filter(r => r !== controller && par.has(r));
		for (let i = 1; i < ps.length; i++) uni(ps[0], ps[i]);
	}

	const groups = new Map();
	for (const r of refs) {
		const root = find(r);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root).push(r);
	}
	const modules = [...groups.values()].map((p, i) => ({ id: `m${i}`, parts: p.sort() }));
	if (controller) modules.push({ id: 'mctrl', parts: [controller] });
	return modules;
}

function columnOf(module, controller, roleByRef) {
	if (module.parts.includes(controller)) return 'center';
	const roles = module.parts.map(r => roleByRef.get(r));
	if (roles.some(x => x === 'connector' || x === 'regulator')) return 'left';
	return 'right';
}

export function inferRoles(logical) {
	const parts = logical.parts || [];
	const nets = logical.nets || [];
	const controller = pickController(parts);
	const touch = partNetIndex(parts, nets);

	const roleByRef = new Map();
	const outParts = parts.map(p => {
		const role = roleOf(p, controller, touch);
		roleByRef.set(p.ref, role);
		return { ref: p.ref, kind: p.kind, role };
	});

	const modules = clusterModules(parts, nets, controller).map(m => ({
		...m,
		role: m.parts.includes(controller) ? 'controller' : (m.parts.map(r => roleByRef.get(r)).find(x => x !== 'support') || 'support'),
		column: columnOf(m, controller, roleByRef),
	}));

	return { controller, parts: outParts, modules };
}

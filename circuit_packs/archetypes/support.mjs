// 角色原型:support 无源件竖直串(泛化 dividerCell)。完全用 cell_helpers 构建几何。
import { toWorld } from '../../engine/transform.mjs';
import { wire, labelStub, gndStub, powerStub, regionOf, q10, mergeParts } from '../../engine/cell_helpers.mjs';

const PITCH = 60;   // 件中心纵向间距(GRID=10 的整数倍)

const pinOf = (part, num) => (part.pins || []).find(p => String(p.num) === String(num));

export function supportArchetype(spec = {}) {
	const { parts, anchor, nets = {}, opts = {} } = spec;
	if (!Array.isArray(parts) || parts.length === 0) {
		throw new Error('supportArchetype: spec.parts must be a non-empty array');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('supportArchetype: spec.anchor {x,y} required');
	}
	for (const p of parts) {
		if ((p.pins || []).length !== 2) {
			throw new Error(`supportArchetype: ${p.designator} is not a 2-terminal part`);
		}
	}
	const tapIndex = Number.isInteger(opts.tapIndex) ? opts.tapIndex : 0;
	if (nets.side && nets.side.class === 'signal' && parts.length < 2) {
		throw new Error('supportArchetype: side signal tap needs >= 2 parts (no internal junction)');
	}
	if (nets.side && nets.side.class === 'signal' && tapIndex > parts.length - 2) {
		throw new Error(`supportArchetype: tapIndex ${tapIndex} out of range (need 0..${parts.length - 2})`);
	}

	// 结点电气校验(有 pinNets 时):链式假设是 parts[k].pin1 与 parts[k+1].pin2 同网。
	// 若实际共享网不符(脚编号/电气序与固定链不匹配),fail-closed 抛错让 planner 回退
	// multipart(按网名接线、不依赖固定拓扑),杜绝"正交却电气接反"的门干净错图(M4)。
	const pinNets = nets.pinNets;
	if (pinNets && parts.length >= 2) {
		for (let k = 0; k + 1 < parts.length; k++) {
			const aNum = (pinOf(parts[k], '1') || parts[k].pins[0]).num;
			const bNum = (pinOf(parts[k + 1], '2') || parts[k + 1].pins[1]).num;
			const na = pinNets[`${parts[k].designator}.${aNum}`];
			const nb = pinNets[`${parts[k + 1].designator}.${bNum}`];
			if (!na || !nb || na.name !== nb.name) {
				throw new Error(`supportArchetype: junction ${parts[k].designator}.${aNum}/${parts[k + 1].designator}.${bNum} 非同网(链式拓扑不匹配,fail-closed)`);
			}
		}
	}

	const place = {};
	const pin = {};   // designator -> { p1:[x,y], p2:[x,y] }
	parts.forEach((part, i) => {
		const pl = { x: anchor.x, y: anchor.y - i * PITCH, rot: 90, mirror: false };
		place[part.designator] = pl;
		const p1 = pinOf(part, '1') || part.pins[0];
		const p2 = pinOf(part, '2') || part.pins[1];
		pin[part.designator] = {
			p1: toWorld(p1.local, [pl.x, pl.y], pl.rot, pl.mirror),
			p2: toWorld(p2.local, [pl.x, pl.y], pl.rot, pl.mirror),
		};
	});

	const frags = [];
	for (let k = 0; k + 1 < parts.length; k++) {
		const a = pin[parts[k].designator].p1;        // 件 k 下端
		const b = pin[parts[k + 1].designator].p2;    // 件 k+1 上端
		if (k === tapIndex && nets.side && nets.side.class === 'signal') {
			const t = [anchor.x, q10((a[1] + b[1]) / 2)];
			frags.push({ wires: [wire('', [a, t]), wire('', [t, b])], flags: [] });
			frags.push(labelStub(nets.side.name, t, { side: 'right', escX: t[0] + 30 }));
		} else {
			frags.push({ wires: [wire('', [a, b])], flags: [] });
		}
	}

	const top = pin[parts[0].designator].p2;
	if (nets.top && nets.top.class === 'power') frags.push(powerStub(nets.top.name, top, { dir: 'up', len: 50 }));
	else if (nets.top && nets.top.class === 'ground') frags.push(gndStub(top, { dir: 'up', len: 30, net: nets.top.name }));
	else if (nets.top && nets.top.class === 'signal') {
		// 信号端点:无源件脚在中心 x、水平逃逸会穿体,故先竖直逃逸到体上方,再顶部水平标签(单电容/滤波等)。
		const e = [top[0], top[1] + 30];
		frags.push({ wires: [wire(nets.top.name, [top, e])], flags: [] });
		frags.push(labelStub(nets.top.name, e, { side: 'right', escX: e[0] + 30 }));
	}

	const bot = pin[parts[parts.length - 1].designator].p1;
	if (nets.bottom && nets.bottom.class === 'ground') frags.push(gndStub(bot, { dir: 'down', len: 30, net: nets.bottom.name }));
	else if (nets.bottom && nets.bottom.class === 'power') frags.push(powerStub(nets.bottom.name, bot, { dir: 'down', len: 50 }));
	else if (nets.bottom && nets.bottom.class === 'signal') {
		const e = [bot[0], bot[1] - 30];
		frags.push({ wires: [wire(nets.bottom.name, [bot, e])], flags: [] });
		frags.push(labelStub(nets.bottom.name, e, { side: 'right', escX: e[0] + 30 }));
	}

	const merged = mergeParts(...frags);
	const pts = [];
	for (const d of Object.keys(pin)) pts.push(pin[d].p1, pin[d].p2);
	const region = regionOf(pts, 20);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region };
}

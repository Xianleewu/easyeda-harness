// 角色原型:fanout 多引脚器件水平扇出(连接器/枢纽)。完全用 cell_helpers 构建几何。
import { toWorld } from '../../engine/transform.mjs';
import { labelStub, gndStub, powerStub, regionOf, mergeParts } from '../../engine/cell_helpers.mjs';
import { assertEscapable } from './densefanout.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

const LABEL_KEEP = 12;                                  // 标签离体净空(对齐 L6)
const labelLen = name => Math.max(40, String(name).length * 6 + 18);

// sig 标签列 x:右向文字(alignMode8)反向左生长、左向(6)右生长,宽名会压回器件体(L2/L6)。
// 按标签宽外推 escX,确保文字框清开体边 ≥LABEL_KEEP(同 densefanout 的宽名处理),让宽名也能渲染。
function sigEscX(world, side, name, body) {
	if (side === 'right') {
		const need = body ? body.maxX + LABEL_KEEP + labelLen(name) : -Infinity;
		return Math.max(world[0] + 30, need);
	}
	const need = body ? body.minX - LABEL_KEEP - labelLen(name) : Infinity;
	return Math.min(world[0] - 30, need);
}

export function fanoutArchetype(spec = {}) {
	const { parts, anchor, nets = {} } = spec;
	if (!Array.isArray(parts) || parts.length !== 1) {
		throw new Error('fanoutArchetype: spec.parts must be exactly one multi-pin component');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('fanoutArchetype: spec.anchor {x,y} required');
	}
	const comp = parts[0];
	const pins = comp.pins || [];
	if (!pins.length) throw new Error('fanoutArchetype: component has no pins');
	const pinNets = nets.pinNets || {};
	const pinNums = new Set(pins.map(p => String(p.num)));
	for (const num of Object.keys(pinNets)) {
		if (!pinNums.has(String(num))) {
			throw new Error(`fanoutArchetype: pinNets references missing pin ${num}`);
		}
	}

	const lb = comp.localBox;
	const body = lb ? { minX: anchor.x + lb.minX, minY: anchor.y + lb.minY, maxX: anchor.x + lb.maxX, maxY: anchor.y + lb.maxY } : null;
	const place = { [comp.designator]: { x: anchor.x, y: anchor.y, rot: 0, mirror: false } };
	const frags = [];
	const pts = [];
	const routed = [];
	for (const p of pins) {
		const world = toWorld(p.local, [anchor.x, anchor.y], 0, false);
		pts.push(world);
		const pn = pinNets[String(p.num)];
		if (!pn) continue;
		const side = p.local[0] >= 0 ? 'right' : 'left';
		routed.push({ num: p.num, world, side, cls: pn.class });
		if (pn.class === 'signal') {
			frags.push(labelStub(pn.name, world, { side, escX: sigEscX(world, side, pn.name, body) }));
		} else if (pn.class === 'power') {
			frags.push(powerStub(pn.name, world, { dir: side, len: 50 }));
		} else if (pn.class === 'ground') {
			frags.push(gndStub(world, { dir: side, len: 30, net: pn.name }));
		}
	}
	// fail-closed:自体内部脚的横向桩必穿自体(拓扑无解,同 densefanout C1),抛错让 planner 跳过。
	if (body) assertEscapable(routed, body, comp.designator);
	const merged = mergeParts(...frags);

	// fail-closed 自检:fanout 无 staircase,同侧脚过密(尤其电源/地符号)会 L3/L2/L6 互压。
	// 用真实 labelQC 判定自身产物(而非手搓阈值),有硬伤即抛错 → planner 跳过该模块,
	// 杜绝单个密集连接器拖垮整图标签门。密集多脚枢纽应由 densefanout 承接,非 fanout。
	if (body) {
		const selfModel = {
			components: [{ designator: comp.designator, bbox: body, pins: pins.map((p, i) => ({ num: p.num, x: pts[i][0], y: pts[i][1] })) }],
			wires: merged.wires, netflags: merged.flags,
		};
		const hard = labelQC(selfModel).filter(f => f.severity === 'hard');
		if (hard.length) {
			throw new Error(`fanout ${comp.designator}: 自检 labelQC ${hard.length} 处硬伤(${hard[0].rule},同侧过密,fail-closed)`);
		}
	}
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}

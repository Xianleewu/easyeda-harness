// 示例电路 pack：电阻分压器（非 AIHWDEBUGER），证明工作流可泛化到新电路族。
// 关键：cell builder 完全用 engine/cell_helpers.mjs 的可复用原语构建几何，
// 不手摆任何导线/网标。这是注册表中第二个真实 pack；由
// engine/divider_pack_smoke.mjs 跑真实 geomQC/labelQC 验证（workflow:smoke WS25）。
import { toWorld } from '../../engine/transform.mjs';
import { wire, labelStub, gndStub, powerStub, mergeParts } from '../../engine/cell_helpers.mjs';

const W = (c, place, num) => {
	const pin = (c.pins || []).find(p => String(p.num) === String(num));
	return toWorld(pin.local, [place.x, place.y], place.rot, place.mirror);
};

/*
 * 分压器：VIN(顶,电源) → R_top → VMID(右侧信号网标) → R_bot → GND(底)。
 * roles {R_top, R_bot}; 每个电阻竖放(rot90)：pin1 在下、pin2 在上。
 * nets {VIN, VMID}（缺省 'VIN'/'VMID'）。
 */
export function dividerCell(byDes, roles, A, nets = {}) {
	const rTop = byDes.get(roles.R_top);
	const rBot = byDes.get(roles.R_bot);
	const place = {
		[roles.R_top]: { x: A.x, y: A.y + 60, rot: 90, mirror: false },
		[roles.R_bot]: { x: A.x, y: A.y - 60, rot: 90, mirror: false },
	};
	const topLow = W(rTop, place[roles.R_top], '1');  /* A.y+40 */
	const topHigh = W(rTop, place[roles.R_top], '2'); /* A.y+80 */
	const botLow = W(rBot, place[roles.R_bot], '1');  /* A.y-80 */
	const botHigh = W(rBot, place[roles.R_bot], '2'); /* A.y-40 */
	const vin = nets.VIN || 'VIN';
	const vmid = nets.VMID || 'VMID';

	const parts = [
		/* 顶部 VIN 电源符号 */
		powerStub(vin, [topHigh[0], topHigh[1]], { dir: 'up', len: 50 }),
		/* 中点节点：无网名竖直连线 R_top.下 -> A -> R_bot.上 */
		{ wires: [wire('', [[topLow[0], topLow[1]], [A.x, A.y]]), wire('', [[A.x, A.y], [botHigh[0], botHigh[1]]])], flags: [] },
		/* 中点右侧 VMID 信号网标（命名水平 stub + 网标，alignMode=8） */
		labelStub(vmid, [A.x, A.y], { side: 'right', escX: A.x + 30 }),
		/* 底部 GND 符号 */
		gndStub([botLow[0], botLow[1]], { dir: 'down', len: 30 }),
	];
	const merged = mergeParts(...parts);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [] };
}

export const fallbackAnchors = { divider: { x: 1000, y: 1000 } };
export const cellBuilders = { dividerCell };
export function normalizeLibrarySnapshot(snap) { return snap; }

export const pack = {
	id: 'divider',
	fallbackAnchors,
	cellBuilders,
	normalizeLibrarySnapshot,
};

// 电路单元模板库：AI 设计标准画法，程序确定性铺图
// 约定：EDA 为 y 朝上；GND 网标 rot=0 朝下；netport rot=0 标签朝右/180 朝左/90 朝上/270 朝下
import { toWorld } from './transform.mjs';
import { layoutTune } from './layout_config.mjs';

const pinOf = (c, num) => c.pins.find(p => String(p.num) === String(num));
const W = (c, place, num) => toWorld(pinOf(c, num).local, [place.x, place.y], place.rot, place.mirror);

// 器件世界坐标包围盒
function worldBBox(c, place) {
	const lb = c.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]]
		.map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	return {
		minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])),
		minY: Math.min(...corners.map(p => p[1])), maxY: Math.max(...corners.map(p => p[1])),
	};
}

const escGap = () => layoutTune.esc_gap;
const stubLen = () => layoutTune.stub_len;
const q5 = v => Math.round(v / 5) * 5;
const q10 = v => Math.round(v / 10) * 10;
const sigLabelWidth = net => Math.max(38, String(net || '').length * 6 + 16);

function escapeLeftToGrid(wires, p, xGrid, net = '') {
	const yGrid = q10(p[1]);
	if (p[1] !== yGrid) {
		const xMid = q10(p[0] - 10);
		wires.push({ net, line: [p[0], p[1], xMid, p[1]] });
		wires.push({ net, line: [xMid, p[1], xMid, yGrid] });
		wires.push({ net, line: [xMid, yGrid, xGrid, yGrid] });
	} else {
		wires.push({ net, line: [p[0], p[1], xGrid, yGrid] });
	}
	return [xGrid, yGrid];
}

// 仅无网名逃出 + 竖直汇流（命名 stub 由调用方在器件外侧单独放置）
function escapeBus(wires, pts, tapY, xEsc) {
	const ys = pts.map(p => p[1]);
	for (const p of pts) {
		if (p[0] !== xEsc)
			wires.push({ net: '', line: [p[0], p[1], xEsc, p[1]] });
	}
	const yMin = Math.min(...ys), yMax = Math.max(...ys);
	if (pts.length > 1) {
		if (yMin < tapY)
			wires.push({ net: '', line: [xEsc, yMin, xEsc, tapY] });
		if (yMax > tapY)
			wires.push({ net: '', line: [xEsc, tapY, xEsc, yMax] });
	} else if (ys[0] !== tapY)
		wires.push({ net: '', line: [xEsc, ys[0], xEsc, tapY] });
}

// 左侧网标列：无网名逃出 -> 无网名汇流 -> 单行水平命名 stub（禁止竖直带网名）
function leftNetBus(wires, flags, pts, net, tapY, cols) {
	const { xEsc, xLbl } = cols;
	const ys = pts.map(p => p[1]);
	for (const p of pts) {
		if (p[0] !== xEsc)
			wires.push({ net: '', line: [p[0], p[1], xEsc, p[1]] });
	}
	const yMin = Math.min(...ys), yMax = Math.max(...ys);
	if (pts.length > 1) {
		if (yMin < tapY)
			wires.push({ net: '', line: [xEsc, yMin, xEsc, tapY] });
		if (yMax > tapY)
			wires.push({ net: '', line: [xEsc, tapY, xEsc, yMax] });
		if (yMin === yMax && yMin !== tapY)
			wires.push({ net: '', line: [xEsc, yMin, xEsc, tapY] });
	} else if (ys[0] !== tapY)
		wires.push({ net: '', line: [xEsc, ys[0], xEsc, tapY] });
	wires.push({ net, line: [xEsc, tapY, xLbl, tapY] });
	flags.push({ kind: 'sig', net, x: xLbl, y: tapY, textX: xLbl, textY: tapY, rot: 180, alignMode: 6 });
}

function leftSingleNet(wires, flags, p, net, tapY, cols) {
	const xLbl = q10(cols.xLbl ?? cols.xEsc - stubLen());
	const xEsc = q5(cols.xEsc ?? p[0] - escGap());
	const xNamedStart = xLbl + stubLen();
	wires.push({ net: '', line: [p[0], p[1], xEsc, p[1]] });
	if (Math.abs(xNamedStart - xEsc) > 1e-6) wires.push({ net: '', line: [xEsc, p[1], xNamedStart, p[1]] });
	wires.push({ net, line: [xNamedStart, p[1], xLbl, p[1]] });
	flags.push({ kind: 'sig', net, x: xLbl, y: p[1], textX: xLbl, textY: p[1], rot: 180, alignMode: 6 });
}

function leftCols(bb, pinXs = []) {
	const edge = pinXs.length ? Math.min(bb.minX, ...pinXs) : bb.minX;
	const xEsc = q5(edge - escGap());
	return { xEsc, xLbl: xEsc - stubLen() };
}

// 一组同 net 引脚(都朝同侧水平出线)汇到竖直母线
function busToRail(pins, railX, net) {
	const ws = [];
	const ys = pins.map(p => q10(p[1]));
	for (const p of pins) {
		const y = q10(p[1]);
		if (p[1] !== y) ws.push({ net, line: [p[0], p[1], p[0], y, railX, y] });
		else ws.push({ net, line: [p[0], p[1], railX, y] });
	}
	ws.push({ net, line: [railX, Math.min(...ys), railX, Math.max(...ys)] });
	return ws;
}

function busToRailDirect(pins, railX, net, railMinY = null, railMaxY = null) {
	const ws = [];
	const ys = pins.map(p => p[1]);
	for (const p of pins) ws.push({ net, line: [p[0], p[1], railX, p[1]] });
	const taps = [railMinY ?? Math.min(...ys), railMaxY ?? Math.max(...ys), ...ys]
		.filter((y, i, arr) => arr.indexOf(y) === i)
		.sort((a, b) => a - b);
	for (let i = 0; i + 1 < taps.length; i++) {
		if (taps[i] !== taps[i + 1]) ws.push({ net, line: [railX, taps[i], railX, taps[i + 1]] });
	}
	return ws;
}

/*
 * 低边 N-MOS 继电器驱动级（标准画法）
 *        D2(续流)      CN(线圈连接器)
 *   COILV ┌──┴──┐ COILV
 *   COILA └──┬──┘ COILA ── 漏极节点
 *            │
 *   EN─[Rs]──┤栅 ┌──Q──┐
 *            │   │ MOS │
 *          [Rpd]源└──┬─┘
 *            │       │
 *           GND     GND
 * roles: {Q, Rs(串阻), Rpd(下拉), D(续流), CN(连接器)}
 * pinrole: Rs.1=EN Rs.2=GATE; Rpd.1=GATE Rpd.2=GND; D.1=COILV(C) D.2=COILA(A);
 *          Q.G=1=GATE Q.S=2=GND Q.D=3=COILA; CN.1=COILV CN.2=COILA
 * nets: {EN}
 */
export function relayDriver(byDes, roles, A, nets) {
	const Q = byDes.get(roles.Q), Rs = byDes.get(roles.Rs), Rpd = byDes.get(roles.Rpd);
	const D = byDes.get(roles.D), CN = byDes.get(roles.CN);
	const place = {
		[roles.Q]:   { x: A.x,        y: A.y,        rot: 0,   mirror: false },
		[roles.Rs]:  { x: A.x - 80,   y: A.y,        rot: 0,   mirror: false },
		[roles.Rpd]: { x: A.x - 40,   y: A.y - 35,   rot: 270, mirror: false },
		[roles.D]:   { x: A.x + 50,   y: A.y + 60,   rot: 270, mirror: false },
		[roles.CN]:  { x: A.x + 120,  y: A.y + 60,   rot: 0,   mirror: false },
	};
	const gG = W(Q, place[roles.Q], 1), gS = W(Q, place[roles.Q], 2), gD = W(Q, place[roles.Q], 3);
	const rs1 = W(Rs, place[roles.Rs], 1), rs2 = W(Rs, place[roles.Rs], 2);
	const rp1 = W(Rpd, place[roles.Rpd], 1), rp2 = W(Rpd, place[roles.Rpd], 2);
	const dK = W(D, place[roles.D], 1), dA = W(D, place[roles.D], 2);
	const cnV = W(CN, place[roles.CN], 1), cnA = W(CN, place[roles.CN], 2);
	const cn3 = W(CN, place[roles.CN], 3), cn4 = W(CN, place[roles.CN], 4);

	const wires = [];
	const enX = rs1[0] - 95;
	wires.push({ net: nets.EN, line: [enX, rs1[1], rs1[0], rs1[1]] });
	wires.push({ net: nets.GATE, line: [rs2[0], rs2[1], rp1[0], A.y] });
	wires.push({ net: nets.GATE, line: [rp1[0], A.y, gG[0], gG[1]] });
	// 栅极节点下拉抽头
	wires.push({ net: nets.GATE, line: [rp1[0], A.y, rp1[0], rp1[1]] });
	// 源极 -> GND
	const gndS = [gS[0], gS[1] - 25];
	wires.push({ net: 'GND', line: [gS[0], gS[1], gndS[0], gndS[1]] });
	// 下拉 -> GND
	const gndP = [rp2[0], rp2[1] - 20];
	wires.push({ net: 'GND', line: [rp2[0], rp2[1], gndP[0], gndP[1]] });
	// 漏极 -> 线圈节点(COILA)，二极管阳极接到该横线(经连接器引脚收敛，避免 T 型中点不连通)
	wires.push({ net: nets.COILA, line: [gD[0], gD[1], gD[0], dA[1], dA[0], dA[1], cnA[0], cnA[1]] });
	// 线圈 V+ 节点(COILV)
	const coilVX = cnV[0];
	wires.push({ net: nets.COILV, line: [dK[0], dK[1], coilVX, dK[1], coilVX, cnV[1]] });
	const noConnects = [{ ref: roles.CN, pin: '3' }, { ref: roles.CN, pin: '4' }];

	const flags = [
		{ kind: 'sig', net: nets.EN, x: enX, y: rs1[1], textX: enX, textY: rs1[1], rot: 180, alignMode: 6 },
		{ kind: 'gnd', net: 'GND', x: gndS[0], y: gndS[1], rot: 0 },
		{ kind: 'gnd', net: 'GND', x: gndP[0], y: gndP[1], rot: 0 },
	];
	return { place, wires, flags, noConnects };
}

/*
 * LDO 稳压：VIN 左进 -> U -> VOUT 右出 + 两路输出电容到地，GND 朝下
 * roles {U, Co1, Co2}; U pins 1=GND 2=VOUT 3=VIN 4=VOUT; Co.1=VOUT Co.2=GND
 * nets {VIN, VOUT}
 */
export function ldoCell(byDes, roles, A, nets) {
	const U = byDes.get(roles.U), Co1 = byDes.get(roles.Co1), Co2 = byDes.get(roles.Co2);
	const place = {
		[roles.U]:   { x: A.x,       y: A.y,       rot: 0,   mirror: false },
		[roles.Co1]: { x: A.x + 90,  y: A.y - 45,  rot: 270, mirror: false },
		[roles.Co2]: { x: A.x + 140, y: A.y - 45,  rot: 270, mirror: false },
	};
	const uG = W(U, place[roles.U], 1), uVo2 = W(U, place[roles.U], 2), uVi = W(U, place[roles.U], 3), uVo4 = W(U, place[roles.U], 4);
	const c1t = W(Co1, place[roles.Co1], 1), c1b = W(Co1, place[roles.Co1], 2);
	const c2t = W(Co2, place[roles.Co2], 1), c2b = W(Co2, place[roles.Co2], 2);
	const wires = [];
	// VIN 进(pin3, y-10)：直接向左，顶部电源符号
	const vinX = A.x - 120;
	wires.push({ net: nets.VIN, line: [uVi[0], uVi[1], vinX, uVi[1], vinX, A.y + 50] });
	// VOUT 右母线(pin4) + 两路输出电容
	const busY = A.y, busR = A.x + 160;
	wires.push({ net: nets.VOUT, line: [uVo4[0], uVo4[1], busR, busY] });
	wires.push({ net: nets.VOUT, line: [c1t[0], busY, c1t[0], c1t[1]] });
	wires.push({ net: nets.VOUT, line: [c2t[0], busY, c2t[0], c2t[1]] });
	// 右母线上引出 3V3 电源符号
	const voX = A.x + 120;
	wires.push({ net: nets.VOUT, line: [voX, busY, voX, A.y + 60] });
	// pin2(VOUT) 经顶部绕到右母线（左短出避开 GND，再上、右、下）
	wires.push({ net: nets.VOUT, line: [uVo2[0], uVo2[1], A.x - 70, uVo2[1], A.x - 70, A.y + 70, A.x + 60, A.y + 70, A.x + 60, busY] });
	// GND pin1(y+10)：左短后上行接地（避开 VIN/pin2 竖线）
	const ug = [A.x - 60, A.y + 40];
	wires.push({ net: 'GND', line: [uG[0], uG[1], ug[0], uG[1], ug[0], ug[1]] });
	// 电容到地
	const g1 = [c1b[0], q10(c1b[1] - 20)], g2 = [c2b[0], q10(c2b[1] - 20)];
	wires.push({ net: 'GND', line: [c1b[0], c1b[1], c1b[0], g1[1]] });
	wires.push({ net: 'GND', line: [c2b[0], c2b[1], c2b[0], g2[1]] });
	const flags = [
		{ kind: 'power', net: nets.VIN, x: vinX, y: A.y + 50, rot: 0 },
		{ kind: 'power', net: nets.VOUT, x: voX, y: A.y + 60, rot: 0 },
		{ kind: 'gnd', net: 'GND', x: ug[0], y: ug[1], rot: 180 },
		{ kind: 'gnd', net: 'GND', x: g1[0], y: g1[1], rot: 0 },
		{ kind: 'gnd', net: 'GND', x: g2[0], y: g2[1], rot: 0 },
	];
	return { place, wires, flags };
}

/*
 * 按键：上拉到 3V3 + 按键到 GND（可选 RESET 电容到 GND），信号网标朝左
 * roles {SW, Rpu, Cap?}; SW tact: 1&3=GND 侧, 2&4=信号侧; Rpu.1=信号 Rpu.2=3V3; Cap.1=信号 Cap.2=GND
 * nets {SIG}
 */
export function buttonCell(byDes, roles, A, nets) {
	const SW = byDes.get(roles.SW), Rpu = byDes.get(roles.Rpu), Cap = roles.Cap ? byDes.get(roles.Cap) : null;
	const place = {
		[roles.SW]:  { x: A.x,        y: A.y,       rot: 0,  mirror: false },
		[roles.Rpu]: { x: A.x + 20,   y: A.y + 55,  rot: 90, mirror: false }, // 上拉竖直在信号节点正上, pin1 下=信号 pin2 上=3V3
	};
	if (Cap) place[roles.Cap] = { x: A.x + 95, y: A.y + 25, rot: 0, mirror: false }; // 横放: pin1 左=信号 pin2 右=GND
	const s1 = W(SW, place[roles.SW], 1), s2 = W(SW, place[roles.SW], 2), s3 = W(SW, place[roles.SW], 3), s4 = W(SW, place[roles.SW], 4);
	const s5 = pinOf(SW, 5) ? W(SW, place[roles.SW], 5) : s4;
	const s6 = pinOf(SW, 6) ? W(SW, place[roles.SW], 6) : s2;
	const rBot = W(Rpu, place[roles.Rpu], 1), rTop = W(Rpu, place[roles.Rpu], 2);
	const wires = [];
	// 信号节点连接等效脚，但避开相邻 NC 标记。
	wires.push({ net: '', line: [s5[0], s5[1], s6[0], s6[1], rBot[0], rBot[1]] });
	// 3V3：上拉上端朝上
	const v3 = [rTop[0], q10(rTop[1] + 20)];
	wires.push({ net: 'SYS_3V3', line: [rTop[0], rTop[1], v3[0], v3[1]] });
	// GND 等效脚竖直相连，符号左移避开 pin3 的 NC 可见标记。
	wires.push({ net: 'GND', line: [s2[0], s2[1], s1[0], s1[1]] });
	const gnd = [q10(s2[0] - 40), s2[1]];
	wires.push({ net: 'GND', line: [s2[0], s2[1], gnd[0], gnd[1]] });
	// 信号引出(朝右去 MCU)，右网名列统一 x
	const sigPin = Cap ? s6 : s5;
	const sigX = A.x + (Cap ? 115 : 95);
	wires.push({ net: nets.SIG, line: [sigPin[0], sigPin[1], sigX, sigPin[1]] });
	const flags = [
		{
			kind: 'sig',
			net: nets.SIG,
			x: sigX,
			y: sigPin[1],
			textX: sigX,
			textY: sigPin[1],
			rot: 0,
			alignMode: 8,
		},
		{ kind: 'power', net: 'SYS_3V3', x: v3[0], y: v3[1], rot: 0 },
		{ kind: 'gnd', net: 'GND', x: gnd[0], y: gnd[1], rot: 270 },
	];
	const noConnects = [];
	if (pinOf(SW, 3)) noConnects.push({ ref: roles.SW, pin: '3' });
	if (pinOf(SW, 4)) noConnects.push({ ref: roles.SW, pin: '4' });
	if (Cap) {
		const cSig = W(Cap, place[roles.Cap], 1), cGnd = W(Cap, place[roles.Cap], 2); // 左=信号 右=GND
		// 信号竖线在 cSig 高度抽头右接电容信号脚
		wires.push({ net: '', line: [s6[0], s6[1], s6[0], cSig[1], cSig[0], cSig[1]] });
		const cg = [cGnd[0], q10(cGnd[1] + 35)];
		wires.push({ net: 'GND', line: [cGnd[0], cGnd[1], cg[0], cg[1]] });
		flags.push({ kind: 'gnd', net: 'GND', x: cg[0], y: cg[1], rot: 180 });
	}
	return { place, wires, flags, noConnects };
}

/*
 * MCU 核心(U1 ESP32-C3)：左侧信号网标(朝左)，3V3 电源符号上引，
 * 左 GND + 右 9 个 GND 汇流到单一地符号
 */
export function mcuCell(byDes, roles, A) {
	const U = byDes.get(roles.U);
	const place = { [roles.U]: { x: A.x, y: A.y, rot: 0, mirror: false } };
	const P = n => W(U, place[roles.U], n);
	const wires = [], flags = [];
	const noConnects = [];
	const ubb = worldBBox(U, place[roles.U]);
	const mcuPinXs = [2, 3, 4, 5, 8, 9, 13, 14].map(n => P(n)[0]);
	const mcuCols = leftCols(ubb, mcuPinXs);
	const xEsc = mcuCols.xEsc;
	const xg = mcuCols.xLbl - 35;
	const leftNets = [
		[[2], 'RESET_EN'], [[3], 'EXT_PWR_EN'], [[4], 'RELAY1_EN'],
		[[5], 'RELAY2_EN'], [[8], 'BOOT_IO9'], [[13], 'USB_DN'], [[14], 'USB_DP'],
	];
	for (const [pins, net] of leftNets) {
		const pts = pins.map(n => P(n));
		const cols = { ...mcuCols, xLbl: mcuCols.xLbl - 40 };
		const tapY = q10(pts[0][1]);
		if (pts.length === 1) leftSingleNet(wires, flags, pts[0], net, tapY, cols);
		else leftNetBus(wires, flags, pts, net, tapY, mcuCols);
	}
	for (const n of [6, 7, 10, 11, 12]) {
		noConnects.push({ ref: roles.U, pin: String(n) });
	}
	for (const n of [15, 16, 17, 18]) {
		noConnects.push({ ref: roles.U, pin: String(n) });
	}
	// 3V3 (pin1) 左出后上行电源符号
	{ const p = P(1); const x = q10(A.x - 80); const y = q10(p[1]);
		wires.push({ net: 'SYS_3V3', line: [p[0], p[1], x, p[1]] });
		if (p[1] !== y) wires.push({ net: 'SYS_3V3', line: [x, p[1], x, y] });
		wires.push({ net: 'SYS_3V3', line: [x, y, x, A.y + 100] });
		flags.push({ kind: 'power', net: 'SYS_3V3', x, y: A.y + 100, rot: 0 }); }
	// 左 GND (pin9)：短水平 stub 直接落地，避免沿符号边竖走线
	// 右侧 9 个 GND (19..27) 汇流
	{ const p = P(9); const gx = q10(p[0] - 130); const gy = p[1];
		wires.push({ net: 'GND', line: [p[0], p[1], gx, p[1]] });
		flags.push({ kind: 'gnd', net: 'GND', x: gx, y: gy, rot: 270 }); }
	const gndPins = [19, 20, 21, 22, 23, 24, 25, 26, 27].map(P);
	{
		const xb = q10(A.x + 70);
		const ys = [...new Set(gndPins.map(p => p[1]))].sort((a, b) => a - b);
		const gndY = q10(Math.min(...ys) - 30);
		for (const p of gndPins) wires.push({ net: 'GND', line: [p[0], p[1], xb, p[1]] });
		const taps = [gndY, ...ys].sort((a, b) => a - b);
		for (let i = 0; i + 1 < taps.length; i++) {
			if (taps[i] !== taps[i + 1]) wires.push({ net: 'GND', line: [xb, taps[i], xb, taps[i + 1]] });
		}
		flags.push({ kind: 'gnd', net: 'GND', x: xb, y: gndY, rot: 0 });
	}
	return { place, wires, flags, noConnects };
}

/*
 * USB-C：J1 + CC 下拉(R9/R10) + D± 串阻(R11/R12) + VBUS 电容(C1)
 * 规则：命名线不穿电阻体；CC 命名段在 R 东侧(J 侧)；DN/DP 用 leftNetBus+串阻东 stub
 */
export function usbCell(byDes, roles, A) {
	const J = byDes.get(roles.J), R9 = byDes.get(roles.Rcc1), R10 = byDes.get(roles.Rcc2);
	const R11 = byDes.get(roles.Rdn), R12 = byDes.get(roles.Rdp), C1 = byDes.get(roles.Cv);
	const Jx = A.x + 5, Jy = A.y + 5;
	const jp = name => {
		const p = J.pins.find(p => p.num === name);
		return toWorld(p.local, [Jx, Jy], 0, false);
	};
	const pinX = jp('A5')[0];
	const colStep = escGap() + 6;
	let colN = 0;
	const nextEsc = () => q5(pinX - 70 - colN++ * colStep);
	const xVbus = q5(pinX - 260);
	const xGnd = xVbus + 50;
	const wires = [], flags = [];
	const place = { [roles.J]: { x: Jx, y: Jy, rot: 0, mirror: false } };

	/* CC 下拉：R 贴 J 左侧，命名线仅 pin2→J，网标由导线显示（密集区不打 sig） */
	const ccPull = (pinName, net, R, role) => {
		const p = jp(pinName);
		place[role] = { x: p[0] - 125, y: p[1], rot: 0, mirror: false };
		const rL = W(R, place[role], 1), rR = W(R, place[role], 2);
		wires.push({ net, line: [rR[0], rR[1], p[0], p[1]] });
		const gx = q10(rL[0] - 90), gy = rL[1];
		wires.push({ net: 'GND', line: [rL[0], rL[1], gx, gy] });
		flags.push({ kind: 'gnd', net: 'GND', x: gx, y: gy, rot: 270 });
	};

	/* D± 串阻：水平逃出带网名 → 无网名竖直汇流 → R → 西向命名 stub */
	const serRes = (pinNames, net, R, role, rowY, xEscOverride = null, labelStub = stubLen(), dupLabelX = null, dupRot = 180) => {
		const xEsc = xEscOverride ?? nextEsc();
		const pts = pinNames.map(jp);
		const placeY = rowY;
		place[role] = { x: xEsc - 20, y: placeY, rot: 0, mirror: false };
		const rL = W(R, place[role], 1), rR = W(R, place[role], 2);
		const main = pts.find(p => p[1] === rowY) || pts[0];
		for (const p of pts) {
			if (p === main) continue;
			const xDup = q5(pinX - 65);
			const yDup = p[1] - 2;
			wires.push({ net, line: [p[0], p[1], xDup, p[1]] });
		}
		wires.push({ net: '', line: [main[0], main[1], rR[0], rR[1]] });
		const xLbl = q5(rL[0] - labelStub);
		wires.push({ net, line: [rL[0], rowY, xLbl, rowY] });
		const mainTextX = xLbl;
		const mainTextY = rowY;
		const mainAlign = 6;
		const mainRot = 180;
		flags.push({ kind: 'sig', net, x: xLbl, y: rowY, textX: mainTextX, textY: mainTextY, rot: mainRot, alignMode: mainAlign });
	};

	ccPull('A5', 'USB_CC1', R9, roles.Rcc1, 1);
	ccPull('B5', 'USB_CC2', R10, roles.Rcc2, -1);
	serRes(['A7', 'B7'], 'USB_DN', R11, roles.Rdn, jp('B7')[1], q5(pinX - 70), 95, q5(pinX - 100), 180);
	serRes(['A6', 'B6'], 'USB_DP', R12, roles.Rdp, jp('B6')[1], q5(pinX - 70), 95, q5(pinX - 110), 180);

	// VBUS
	{ const a = jp('A4B9'), b = jp('B4A9');
		const vy = q10(Math.max(a[1], b[1]) + 35);
		const xEv = q5(pinX - escGap());
		wires.push({ net: '', line: [a[0], a[1], xEv, a[1]] });
		wires.push({ net: '', line: [b[0], b[1], xEv, b[1]] });
		wires.push({ net: 'SYS_5V', line: [xEv, a[1], xVbus, a[1]] });
		wires.push({ net: 'SYS_5V', line: [xEv, b[1], xVbus, b[1]] });
		wires.push({ net: 'SYS_5V', line: [xVbus, Math.min(a[1], b[1]), xVbus, vy] }); }
	// GND 两脚
	{ const p = jp('A1B12');
		const eg = q5(pinX - escGap() * 2);
		const gy = p[1] + 30;
		wires.push({ net: '', line: [p[0], p[1], eg, p[1]] });
		wires.push({ net: 'GND', line: [eg, p[1], xGnd, p[1], xGnd, gy] });
		flags.push({ kind: 'gnd', net: 'GND', x: xGnd, y: gy, rot: 180 }); }
	{ const p = jp('B1A12');
		const eg = q5(pinX - escGap() * 3);
		const gy = p[1] - 30;
		wires.push({ net: '', line: [p[0], p[1], eg, p[1]] });
		wires.push({ net: 'GND', line: [eg, p[1], xGnd, p[1], xGnd, gy] });
		flags.push({ kind: 'gnd', net: 'GND', x: xGnd, y: gy, rot: 0 }); }
	// EH 屏蔽
	{ const ehs = ['1', '2', '3', '4'].map(jp); const bx = A.x + 60;
		for (const p of ehs) wires.push({ net: 'GND', line: [p[0], p[1], bx, p[1]] });
		const ey = ehs.map(p => p[1]);
		wires.push({ net: 'GND', line: [bx, Math.min(...ey), bx, Math.max(...ey)] });
		wires.push({ net: 'GND', line: [bx, Math.min(...ey), bx, Math.min(...ey) - 20] });
		flags.push({ kind: 'gnd', net: 'GND', x: bx, y: Math.min(...ey) - 20, rot: 0 }); }
	const noConnects = [{ ref: roles.J, pin: 'A8' }, { ref: roles.J, pin: 'B8' }];
	// VBUS 电容（母线不穿过器件体）
	place[roles.Cv] = { x: q10(xVbus - 20), y: A.y + 60, rot: 270, mirror: false };
	{ const vy = q10(Math.max(jp('A4B9')[1], jp('B4A9')[1]) + 35);
		const cUp = W(C1, place[roles.Cv], 1), cDn = W(C1, place[roles.Cv], 2);
		const pwrY = q10(vy + 50);
		wires.push({ net: 'SYS_5V', line: [xVbus, vy, xVbus, pwrY] });
		flags.push({ kind: 'power', net: 'SYS_5V', x: xVbus, y: pwrY, rot: 0 });
		wires.push({ net: '', line: [xVbus, pwrY, cUp[0], pwrY, cUp[0], cUp[1]] });
		const gy = q10(cDn[1] - 70);
		wires.push({ net: 'GND', line: [cDn[0], cDn[1], cDn[0], gy] });
		flags.push({ kind: 'gnd', net: 'GND', x: cDn[0], y: gy, rot: 0 }); }
	return { place, wires, flags, noConnects };
}

/*
 * P-MOS 高边开关 + N-MOS 驱动
 * Q1(P-MOS): S=VIN(1,2,3) G(4) D=VOUT(5,6,7,8); Q2(N-MOS) 驱动; D1 zener 栅源钳位
 */
export function pmosCell(byDes, roles, A) {
	const Q1 = byDes.get(roles.Q1), Q2 = byDes.get(roles.Q2), D1 = byDes.get(roles.D1);
	const R1 = byDes.get(roles.R1), R2 = byDes.get(roles.R2), R3 = byDes.get(roles.R3), R4 = byDes.get(roles.R4);
	const CN1 = byDes.get(roles.CN1), CN2 = byDes.get(roles.CN2);
	const place = {
		[roles.Q1]:  { x: A.x,        y: A.y,        rot: 0,   mirror: false },
		[roles.R1]:  { x: A.x - 60,   y: A.y + 70,   rot: 90,  mirror: false }, // 栅极上拉到 VIN
		[roles.D1]:  { x: A.x - 95,   y: A.y + 70,   rot: 90,  mirror: false }, // 栅源 zener，与 R1 两端对齐
		[roles.R2]:  { x: A.x - 60,   y: A.y - 70,   rot: 90,  mirror: false }, // 栅极到 Q2 漏
		[roles.Q2]:  { x: A.x - 60,   y: A.y - 150,  rot: 0,   mirror: false },
		[roles.R3]:  { x: A.x - 150,  y: A.y - 150,  rot: 0,   mirror: false }, // Q2 栅串阻
		[roles.R4]:  { x: A.x - 100,  y: A.y - 195,  rot: 270, mirror: false }, // Q2 栅下拉(.1 栅在上/.2 地在下)
		[roles.CN1]: { x: A.x - 190,  y: A.y + 60,   rot: 180, mirror: false }, // 输入(端子朝右)
		[roles.CN2]: { x: A.x + 95,   y: A.y + 20,   rot: 0,   mirror: false }, // 输出(端子朝左)
	};
	place[roles.CN1] = { x: A.x - 170, y: A.y + 55, rot: 180, mirror: false };
	place[roles.CN2] = { x: A.x + 95, y: A.y + 20, rot: 0, mirror: false };
	place[roles.Q2] = { x: A.x - 70, y: A.y - 135, rot: 0, mirror: false };
	place[roles.R3] = { x: A.x - 150, y: A.y - 135, rot: 0, mirror: false };
	place[roles.R4] = { x: A.x - 100, y: A.y - 170, rot: 270, mirror: false };
	const wires = [], flags = [];
	const noConnects = [];
	const q1S = [1, 2, 3].map(n => W(Q1, place[roles.Q1], n));
	const q1G = W(Q1, place[roles.Q1], 4);
	const q1D = [5, 6, 7, 8].map(n => W(Q1, place[roles.Q1], n));
	// VIN 源母线(左) + CN1.1 + R1 上 + D1 + VIN 电源符号
	const sMaxY = Math.max(...q1S.map(p => p[1]));
	for (const w of busToRailDirect(q1S, A.x - 40, 'VIN_12_19V')) wires.push(w);
	wires.push({ net: 'VIN_12_19V', line: [A.x - 40, sMaxY, A.x - 40, A.y + 125] });
	flags.push({ kind: 'power', net: 'VIN_12_19V', x: A.x - 40, y: A.y + 125, rot: 0 });
	// VOUT 漏母线(右) + CN2.1 + VOUT 电源符号
	const cn2_1 = W(CN2, place[roles.CN2], 1), cn2_2 = W(CN2, place[roles.CN2], 2);
	for (const w of busToRailDirect(q1D, A.x + 40, 'VOUT_SW', null, A.y + 90)) wires.push(w);
	wires.push({ net: 'VOUT_SW', line: [A.x + 40, cn2_1[1], cn2_1[0], cn2_1[1]] });
	flags.push({ kind: 'power', net: 'VOUT_SW', x: A.x + 40, y: A.y + 90, rot: 0 });
	// 栅极节点: Q1.G + R1.1 + R2.2 + D1.1(C)
	const r1b = W(R1, place[roles.R1], 1), r1t = W(R1, place[roles.R1], 2); // rot90 pin1 下 pin2 上
	const r2b = W(R2, place[roles.R2], 1), r2t = W(R2, place[roles.R2], 2);
	const d1c = W(D1, place[roles.D1], 1), d1a = W(D1, place[roles.D1], 2); // rot90: ?
	// 栅极水平节点线 y = q1G.y
	wires.push({ net: 'PMOS_GATE', line: [q1G[0], q1G[1], A.x - 60, q1G[1]] }); // 到 R1/R2 列
	wires.push({ net: 'PMOS_GATE', line: [A.x - 60, q1G[1], A.x - 60, r1b[1]] }); // 上接 R1 下脚
	wires.push({ net: 'PMOS_GATE', line: [A.x - 60, q1G[1], A.x - 60, r2t[1]] }); // 下接 R2 上脚
	// R1 上脚 -> VIN 母线
	wires.push({ net: 'VIN_12_19V', line: [r1t[0], r1t[1], A.x - 40, r1t[1]] });
	// D1 栅源钳位与 R1 并排接入，避免 VIN 线绕行。
	wires.push({ net: 'PMOS_GATE', line: [d1c[0], d1c[1], r1b[0], r1b[1]] });
	wires.push({ net: 'VIN_12_19V', line: [d1a[0], d1a[1], r1t[0], r1t[1]] });
	// Q2 漏 -> R2 下脚(PGATE_PULL)
	const q2G = W(Q2, place[roles.Q2], 1), q2S = W(Q2, place[roles.Q2], 2), q2D = W(Q2, place[roles.Q2], 3);
	wires.push({ net: 'PGATE_PULL', line: [q2D[0], q2D[1], r2b[0], r2b[1]] });
	// Q2 源 -> GND
	const q2g = [q2S[0], q2S[1] - 30]; wires.push({ net: 'GND', line: [q2S[0], q2S[1], q2g[0], q2g[1]] }); flags.push({ kind: 'gnd', net: 'GND', x: q2g[0], y: q2g[1], rot: 0 });
	// Q2 栅: R3 串阻(EXT_PWR_EN 进) + R4 下拉
	const r3l = W(R3, place[roles.R3], 1), r3r = W(R3, place[roles.R3], 2);
	wires.push({ net: 'Q2_GATE', line: [r3r[0], r3r[1], q2G[0], r3r[1], q2G[0], q2G[1]] });
	const exL = r3l[0] - 105; wires.push({ net: 'EXT_PWR_EN', line: [r3l[0], r3l[1], exL, r3l[1]] }); flags.push({ kind: 'sig', net: 'EXT_PWR_EN', x: exL, y: r3l[1], textX: exL, textY: r3l[1], rot: 180, alignMode: 6 });
	const r4t = W(R4, place[roles.R4], 1), r4b = W(R4, place[roles.R4], 2);
	wires.push({ net: 'Q2_GATE', line: [r4t[0], r4t[1], r4t[0], q2G[1], q2G[0], q2G[1]] });
	const r4g = [r4b[0], r4b[1] - 20]; wires.push({ net: 'GND', line: [r4b[0], r4b[1], r4g[0], r4g[1]] }); flags.push({ kind: 'gnd', net: 'GND', x: r4g[0], y: r4g[1], rot: 0 });
	// CN1 输入(rot180 端子朝右): .1=VIN(向上绕到 VIN 轨) .2=GND(向下)
	const cn1_1 = W(CN1, place[roles.CN1], 1), cn1_2 = W(CN1, place[roles.CN1], 2);
	const cn1_3 = W(CN1, place[roles.CN1], 3), cn1_4 = W(CN1, place[roles.CN1], 4);
	const cn1p = [cn1_1[0] + 35, cn1_1[1]]; wires.push({ net: 'VIN_12_19V', line: [cn1_1[0], cn1_1[1], cn1p[0], cn1p[1]] }); flags.push({ kind: 'power', net: 'VIN_12_19V', x: cn1p[0], y: cn1p[1], rot: 0 });
	const cn1g = [cn1_2[0], cn1_2[1] + 35]; wires.push({ net: 'GND', line: [cn1_2[0], cn1_2[1], cn1g[0], cn1g[1]] }); flags.push({ kind: 'gnd', net: 'GND', x: cn1g[0], y: cn1g[1], rot: 180 });
	noConnects.push({ ref: roles.CN1, pin: '3' }, { ref: roles.CN1, pin: '4' });
	// CN2 输出地(端子朝左): .2=GND 向下
	const cn2g = [cn2_2[0], cn2_2[1] - 30]; wires.push({ net: 'GND', line: [cn2_2[0], cn2_2[1], cn2g[0], cn2g[1]] }); flags.push({ kind: 'gnd', net: 'GND', x: cn2g[0], y: cn2g[1], rot: 0 });
	const cn2_3 = W(CN2, place[roles.CN2], 3), cn2_4 = W(CN2, place[roles.CN2], 4);
	noConnects.push({ ref: roles.CN2, pin: '3' }, { ref: roles.CN2, pin: '4' });
	return { place, wires, flags, noConnects };
}

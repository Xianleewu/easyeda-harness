// 通用网表质量门(零特定电路内容):对【任意板】快照做电气连通性体检,
// 找出商用原理图常见的网级缺陷——供 DRC 前自查 / 修复决策。纯几何 + 命名规则,不硬编码任何网名。
//
//   import { netQC } from './engine/net_qc.mjs';
//   const findings = netQC(snapshot);   // { shorts, strayPowerFlags, malformedWires, danglingFlags }
//
// 设计依据(2026-06 真实板验证):杂散电源标落在他网导线上=短路;不同命名网经导线相连=短路;
// 导线自我回折/零长段=畸形;网标下方无任何导线/引脚=悬空标。均为 EDA DRC 高频告警来源。

// 电源/地网名判定(通用前缀,与 wire_label_qc 一致,不含任何特定电路网名)。
const isPowerOrGround = n => /^(GND|VSS|AGND|DGND|PGND|VBUS|VCC|VDD|VIN|VOUT|VBAT|VSYS|VPP|VEE|AVDD|DVDD|VDDA|VAA|BL_|\+)/i.test(n) || /^\d+V/i.test(n);
// 两个电源网名是否属于"同一物理轨的别名"(如 +5V / VBUS_5V / 5V_LED 都含 5V token)。
function sameRail(a, b) {
	if (a === b) return true;
	const tok = s => (String(s).match(/\d+V\d*|\d+v\d*/g) || []).map(t => t.toUpperCase());
	const ta = tok(a), tb = tok(b);
	if (ta.length && tb.length && ta.some(t => tb.includes(t))) return true;   // 共享电压 token → 同轨别名
	const gnd = s => /^(GND|VSS|AGND|DGND|PGND)/i.test(s);
	return gnd(a) && gnd(b);   // 地网互为别名
}

const keyOf = (x, y, tol) => `${Math.round(x / tol) * tol},${Math.round(y / tol) * tol}`;

// 点 (px,py) 是否落在正交线段 (x1,y1)-(x2,y2) 上(含端点,容差 tol)。
function pointOnSeg(px, py, x1, y1, x2, y2, tol) {
	if (x1 === x2) return Math.abs(px - x1) <= tol && py >= Math.min(y1, y2) - tol && py <= Math.max(y1, y2) + tol;
	if (y1 === y2) return Math.abs(py - y1) <= tol && px >= Math.min(x1, x2) - tol && px <= Math.max(x1, x2) + tol;
	// 斜段:用包围盒粗判 + 端点距离(斜线本身是 DR1 缺陷,这里只做粗略命中)
	return (Math.abs(px - x1) <= tol && Math.abs(py - y1) <= tol) || (Math.abs(px - x2) <= tol && Math.abs(py - y2) <= tol);
}

export function netQC(snap, opts = {}) {
	const tol = opts.tol || 3;
	const comps = snap.components || [], wires = snap.wires || [], flags = snap.netflags || [];
	const pins = [];
	for (const c of comps) for (const p of (c.pins || [])) if (p.x != null) pins.push({ ref: `${c.designator}.${p.num}`, x: p.x, y: p.y });

	// ── 并查集:全导线顶点共点 + T 接点(端点落他线段)连通 ────────────────────
	const par = new Map();
	const find = a => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
	const add = k => { if (!par.has(k)) par.set(k, k); };
	const uni = (a, b) => { add(a); add(b); par.set(find(a), find(b)); };
	const K = (x, y) => keyOf(x, y, tol);
	for (const w of wires) { const l = w.line || []; for (let i = 0; i + 2 < l.length; i += 2) uni(K(l[i], l[i + 1]), K(l[i + 2], l[i + 3])); }
	for (const w of wires) {
		const l = w.line || []; if (l.length < 2) continue;
		for (const [ex, ey] of [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]) {
			for (const w2 of wires) { if (w2 === w) continue; const m = w2.line || []; for (let i = 0; i + 2 < m.length; i += 2) if (pointOnSeg(ex, ey, m[i], m[i + 1], m[i + 2], m[i + 3], tol)) uni(K(ex, ey), K(m[i], m[i + 1])); }
		}
	}
	// 簇 → 命名网集合
	const clusterNets = new Map();
	const tag = (x, y, net) => { if (!net) return; const k = K(x, y); add(k); const r = find(k); if (!clusterNets.has(r)) clusterNets.set(r, new Set()); clusterNets.get(r).add(net); };
	for (const w of wires) { if (!w.net) continue; const l = w.line || []; tag(l[0], l[1], w.net); tag(l[l.length - 2], l[l.length - 1], w.net); }
	for (const f of flags) tag(f.x, f.y, f.net);

	// ① 短路:一个电气簇含 2+ 个【非同轨别名】的命名网
	const shorts = [];
	for (const nets of clusterNets.values()) {
		const arr = [...nets];
		for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
			if (!sameRail(arr[i], arr[j])) { shorts.push({ nets: [arr[i], arr[j]] }); }
		}
	}

	// ② 杂散电源/地标:flag 落在【他网且非同轨】的导线上 → 把电源串到信号/异轨
	const strayPowerFlags = [];
	for (const f of flags) {
		if (!isPowerOrGround(f.net || '')) continue;
		for (const w of wires) {
			if (!w.net || w.net === f.net || sameRail(w.net, f.net)) continue;
			const l = w.line || [];
			let hit = false;
			for (let i = 0; i + 2 < l.length; i += 2) if (pointOnSeg(f.x, f.y, l[i], l[i + 1], l[i + 2], l[i + 3], tol)) { hit = true; break; }
			if (hit) { strayPowerFlags.push({ flag: f.net, x: f.x, y: f.y, onNet: w.net }); break; }
		}
	}

	// ③ 畸形导线:相邻三点回折(第三点==第一点)或零长段
	const malformedWires = [];
	for (const w of wires) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			if (l[i] === l[i + 2] && l[i + 1] === l[i + 3]) { malformedWires.push({ net: w.net || '', kind: 'zero-length', at: [l[i], l[i + 1]] }); break; }
			if (i + 5 < l.length && l[i] === l[i + 4] && l[i + 1] === l[i + 5]) { malformedWires.push({ net: w.net || '', kind: 'backtrack', at: [l[i + 2], l[i + 3]] }); break; }
		}
	}

	// ④ 悬空网标:flag 下方无任何导线顶点/线段、也无引脚(容差 tol+3)
	const t2 = tol + 3;
	const danglingFlags = [];
	for (const f of flags) {
		const onWire = wires.some(w => { const l = w.line || []; for (let i = 0; i < l.length; i += 2) if (Math.abs(l[i] - f.x) <= t2 && Math.abs(l[i + 1] - f.y) <= t2) return true; for (let i = 0; i + 2 < l.length; i += 2) if (pointOnSeg(f.x, f.y, l[i], l[i + 1], l[i + 2], l[i + 3], t2)) return true; return false; });
		const onPin = pins.some(p => Math.abs(p.x - f.x) <= t2 && Math.abs(p.y - f.y) <= t2);
		if (!onWire && !onPin) danglingFlags.push({ net: f.net, x: f.x, y: f.y });
	}

	// ⑤ ERC 引脚电气类型体检(需快照含 pin.type;否则跳过)。无源件(R/C/L/FB/RN)的脚电气类型
	// 应为 Passive,若被符号错标为 IN/OUT/Input/Output → EDA ERC "输入未驱动/输出冲突" 类告警的常见根因。
	// 任意板通用:仅按位号前缀判无源件,不硬编码任何特定器件;修复需在符号库改引脚类型(schematic 写不了)。
	const PASSIVE_REF = /^(R|C|L|FB|RN|BD)\d/;
	const ercPinType = [];
	for (const c of comps) {
		if (!PASSIVE_REF.test(c.designator || '')) continue;
		for (const p of (c.pins || [])) {
			if (p.type && /^(IN|OUT|Input|Output|Bidirectional|BI)$/i.test(p.type)) {
				ercPinType.push({ ref: `${c.designator}.${p.num}`, pinType: p.type, expect: 'Passive' });
			}
		}
	}

	return { shorts, strayPowerFlags, malformedWires, danglingFlags, ercPinType };
}

// 通用网级修复规划:把 netQC 检出的【schematic 层可修】缺陷转成有序修复操作描述(供 deliver 层经
// bridge 应用)。仅含原理图层能安全修复的两类:① 删杂散电源短路标 ② 拉直/清畸形线。
// 不自动处理:悬空标(DRC 中性)、ERC 引脚类型(需符号库,schematic 写不了)、短路簇(需人判保留哪个网)。
// 纯函数、零特定电路内容、可测;实测对应 live 板 warn 112→99 的有效操作集。
export function netRepairPlan(snap, opts = {}) {
	const r = netQC(snap, opts);
	const ops = [];
	for (const f of r.strayPowerFlags) ops.push({ kind: 'delete-flag', net: f.flag, x: f.x, y: f.y, reason: `杂散电源短路:${f.flag} 压在 ${f.onNet} 线上` });
	for (const w of r.malformedWires) ops.push({ kind: 'straighten-wire', at: w.at, defect: w.kind, net: w.net, reason: `畸形线(${w.kind})` });
	return {
		ops,
		autoFixable: ops.length,
		manualOnly: {
			ercPinType: r.ercPinType.length,        // 需符号库改引脚电气类型
			shorts: r.shorts.length,                  // 需人判保留哪个网名
			danglingFlags: r.danglingFlags.length,    // DRC 中性,可选清理
		},
	};
}

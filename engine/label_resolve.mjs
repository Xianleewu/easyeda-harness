// 标签碰撞消解器(纯几何后处理):消解跨模块同名网标落同 y 的 L10。
//
// 装配后,跨模块同名网(中心列↔侧列)的两个网标可能落同一 y → wire_label_qc L10
// (按 net|y 分组、忽略 x)。模块内 side-phase 已挡同列碰撞,残留仅跨列。
// 策略:保留碰撞组首个标签,把其余标签的命名 stub 经竖直 jog 重路由到附近空闲 y。
// 正确性靠**门精确**:每个候选 y 试应用后跑真实 labelQC+geomQC,只接受让总硬伤
// 严格下降的移动(杜绝把 L10 换成 L4/L2/L6);找不到则保留(留残余 L10,不恶化)。
import { labelQC } from './label_qc.mjs';
import { geomQC } from './geom_qc.mjs';

const EPS = 1;

function countHard(model) {
	const lh = labelQC(model).filter(f => f.severity === 'hard').length;
	const g = geomQC(model);
	return lh + g.overlaps.length + g.wireThruComp.length + g.crossings + g.offgrid;
}

// 找 flag F 的命名 stub(net 匹配、水平 2 点折线、一端贴 F 位置)。
function findStub(model, F) {
	for (const w of (model.wires || [])) {
		if ((w.net || '') !== F.net) continue;
		const l = w.line || [];
		if (l.length !== 4 || Math.abs(l[1] - l[3]) > EPS) continue;
		const hitA = Math.abs(l[0] - F.x) < EPS && Math.abs(l[1] - F.y) < EPS;
		const hitB = Math.abs(l[2] - F.x) < EPS && Math.abs(l[3] - F.y) < EPS;
		if (hitA || hitB) return { wire: w, fEnd: hitA ? 0 : 2 };
	}
	return null;
}

// 就地消解 model 的 L10 标签碰撞;返回同一 model(无碰撞则原样返回)。
export function resolveLabelCollisions(model, opts = {}) {
	if (!model || !Array.isArray(model.netflags) || !Array.isArray(model.wires)) return model;
	const span = Number.isFinite(opts.span) ? opts.span : 400;   // 候选 y 搜索半径
	const hasL10 = labelQC(model).some(f => f.rule === 'L10-dup-named-stub');
	if (!hasL10) return model;

	const sig = model.netflags.filter(f => f.kind === 'sig' && f.net);
	const groups = new Map();
	for (const f of sig) { const k = `${f.net}|${Math.round(f.y)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }

	let base = countHard(model);
	for (const arr of groups.values()) {
		if (arr.length < 2) continue;
		for (let i = 1; i < arr.length; i++) {
			const F = arr[i];
			const found = findStub(model, F);
			if (!found) continue;
			const stub = found.wire;
			const sx = stub.line[2 - found.fEnd], sy = stub.line[3 - found.fEnd];
			const origLine = stub.line.slice(), origY = F.y, origTY = F.textY;
			let moved = false;
			for (let d = 10; d <= span && !moved; d += 10) {
				for (const cand of [Math.round(origY) - d, Math.round(origY) + d]) {
					stub.line = [sx, cand, F.x, cand];                    // 命名段移到 cand
					const jog = { net: '', line: [sx, sy, sx, cand] };    // 竖直 jog 接回逃出端
					model.wires.push(jog);
					F.y = cand; if (F.textY != null) F.textY = cand;
					if (countHard(model) < base) { base = countHard(model); moved = true; break; }
					model.wires.pop();                                    // 回退
					stub.line = origLine.slice(); F.y = origY; if (F.textY != null) F.textY = origTY;
				}
			}
		}
	}
	return model;
}

// 项目无关的"设计语言"合规审计（纯函数，无模块注册表依赖）
//
// 不靠预声明的项目模块，直接从快照本身量设计语言遵守度，并映射到
// schematic_design_rulebook / schematic-design-rules(DR) 的可量门：
//   DR-compact-sprawl        器件散落、填充率过低（rulebook §2.3 紧凑性）
//   DR3-wire-through-component 线穿器件本体（rulebook §3.8 / 几何门）
//   DR2-different-net-crossing 异网导线交叉（rulebook §3.6）
//   DR4-visible-object-overlap 可见对象重叠（rulebook §4）
//   DR8-label-issue          标签问题：浮空/压线/列不齐（rulebook §3 / DR8-DR16）
//
// geom = geomQC(snapshot), labels = labelQC(snapshot)（由调用方注入，便于测试）。

const DEFAULT_FILL_MIN = 0.05;

function bboxArea(b) {
	if (!b) return 0;
	const w = (b.maxX - b.minX), h = (b.maxY - b.minY);
	return (w > 0 && h > 0) ? w * h : 0;
}

function unionBox(boxes) {
	const valid = boxes.filter(Boolean);
	if (!valid.length) return null;
	return {
		minX: Math.min(...valid.map(b => b.minX)),
		minY: Math.min(...valid.map(b => b.minY)),
		maxX: Math.max(...valid.map(b => b.maxX)),
		maxY: Math.max(...valid.map(b => b.maxY)),
	};
}

/* 填充率 = 器件本体面积之和 / 内容外接框面积。低 = 散落、大片空白。 */
export function fillEfficiency(components) {
	const boxes = (components || []).map(c => c.bbox || c.bodyBBox).filter(Boolean);
	const partAreaSum = boxes.reduce((s, b) => s + bboxArea(b), 0);
	const content = unionBox(boxes);
	const contentArea = content ? bboxArea(content) : 0;
	return { partAreaSum, contentArea, contentBox: content, ratio: contentArea > 0 ? partAreaSum / contentArea : 0 };
}

export function auditConformance(snapshot, opts = {}) {
	const components = snapshot?.components || [];
	const geom = opts.geom || { wireThruComp: [], crossings: 0, overlaps: [] };
	const labels = opts.labels || [];
	const fillMin = opts.fillMin ?? DEFAULT_FILL_MIN;

	const fill = fillEfficiency(components);
	const labelHard = labels.filter(l => l.severity === 'hard').length;
	const wtc = (geom.wireThruComp || []).length;
	const crossings = geom.crossings || 0;
	const overlaps = (geom.overlaps || []).length;

	const violations = [];
	const add = (rule, severity, count, detail) => violations.push({ rule, severity, count, detail });

	if (components.length && fill.ratio < fillMin) {
		add('DR-compact-sprawl', 'hard', 1,
			`填充率 ${(fill.ratio * 100).toFixed(1)}% < ${(fillMin * 100).toFixed(0)}%：器件散落、模块不紧凑（rulebook §2.3）`);
	}
	if (wtc > 0) add('DR3-wire-through-component', 'hard', wtc, '导线穿过器件本体');
	if (crossings > 0) add('DR2-different-net-crossing', 'hard', crossings, '异网导线交叉');
	if (overlaps > 0) add('DR4-visible-object-overlap', 'hard', overlaps, '可见对象重叠');
	if (labelHard > 0) add('DR8-label-issue', 'hard', labelHard, '标签浮空/压线/列不齐/假网名');

	return {
		metrics: {
			parts: components.length,
			fillRatio: fill.ratio,
			contentBox: fill.contentBox,
			partAreaSum: fill.partAreaSum,
			wireThroughComponent: wtc,
			differentNetCrossings: crossings,
			overlaps,
			labelIssues: labelHard,
		},
		violations,
		verdict: violations.length ? 'VIOLATES' : 'CONFORMS',
	};
}

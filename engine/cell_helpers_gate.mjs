// cell helper 原语门禁：证明 engine/cell_helpers.mjs 的 helper
//   (1) 正向：拼出的模块几何能通过真实 geomQC + labelQC，hard=0；
//   (2) 负向：对已知坏用法（斜线、错误标签方向、超长 stub、空网名、
//       净空不足、悬空网标、非法属性间距）在构造期 fail-fast 抛错。
// 这把「视觉/标签质量」从提示词约束变成可执行约束，并防止坏行为回归。
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import {
	attachLabelColumn,
	labelStub,
	gndStub,
	powerStub,
	sigFlag,
	wire,
	elbow,
	moduleRect,
	regionOf,
	rectsOverlap,
	attributeAnchor,
	assertOrthogonalWires,
	assertLabelsAttached,
	mergeParts,
	q10,
} from './cell_helpers.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const REPORT = process.env.EASYEDA_CELL_HELPERS_REPORT || `${ROOT}/cell_helpers_report.json`;

/* 用 helper 拼一个最小但完整的模块，喂给真实门禁 */
function buildPositiveModel() {
	const bbox = { minX: 300, minY: 240, maxX: 340, maxY: 300 };
	const comp = {
		designator: 'U1',
		bbox,
		pins: [
			{ num: '1', x: 300, y: 290 },
			{ num: '2', x: 300, y: 270 },
			{ num: '3', x: 300, y: 250 },
			{ num: '4', x: 340, y: 290 },
			{ num: '5', x: 320, y: 240 },
		],
	};
	const escLeft = 280;
	const left = mergeParts(
		/* 多引脚扇出：无网名逃出 -> 无网名竖直母线 -> 单条命名 stub -> 网标（L7/L8 关键路径） */
		attachLabelColumn('SIG_A', [[300, 290], [300, 270]], { side: 'left', escX: escLeft }),
		labelStub('SIG_C', [300, 250], { side: 'left', escX: escLeft }),
	);
	const right = labelStub('SIG_OUT', [340, 290], { side: 'right', escX: 400 });
	const gnd = gndStub([320, 240], { dir: 'down', len: 40 });
	const pwr = powerStub('SYS_3V3', [500, 500], { dir: 'up', len: 50 });
	const parts = mergeParts(left, right, gnd, pwr);
	return {
		model: {
			components: [comp],
			wires: parts.wires,
			netflags: parts.flags,
		},
		parts,
	};
}

function runPositive(findings, checks) {
	const { model, parts } = buildPositiveModel();
	/* 构造期自检（helper 应保证正交且无悬空标签） */
	let buildSelfCheck = 'pass';
	try {
		assertOrthogonalWires(parts.wires);
		assertLabelsAttached(parts.wires, parts.flags);
	} catch (e) {
		buildSelfCheck = e.message;
		findings.push({ rule: 'CH-positive-selfcheck', severity: 'hard', category: 'cell-helper',
			msg: 'helper output failed build-time self check', where: { error: e.message } });
	}
	const g = geomQC(model);
	const labelFindings = labelQC(model);
	const labelHard = labelFindings.filter(f => f.severity === 'hard');
	checks.positive = {
		buildSelfCheck,
		wires: parts.wires.length,
		flags: parts.flags.length,
		geom: { overlaps: g.overlaps.length, wireThruComp: g.wireThruComp.length, offgrid: g.offgrid, crossings: g.crossings },
		labelHard: labelHard.length,
		labelRules: labelHard.map(f => f.rule),
	};
	if (g.overlaps.length || g.wireThruComp.length || g.offgrid || g.crossings) {
		findings.push({ rule: 'CH-positive-geometry', severity: 'hard', category: 'cell-helper',
			msg: 'helper-built module fails geometry QC', where: checks.positive.geom });
	}
	if (labelHard.length) {
		findings.push({ rule: 'CH-positive-label', severity: 'hard', category: 'cell-helper',
			msg: 'helper-built module fails label QC', where: { rules: labelHard.map(f => f.rule), first: labelHard[0] } });
	}
}

/* 每条负向用例都必须抛错；不抛错即视为可执行约束回归（hard） */
const NEGATIVE_CASES = [
	{ id: 'diagonal-wire', run: () => wire('X', [[0, 0], [10, 10]]) },
	{ id: 'single-point-polyline', run: () => wire('X', [[5, 5]]) },
	{ id: 'bad-label-side', run: () => sigFlag('NET', 0, 0, 'up') },
	{ id: 'empty-net-label', run: () => attachLabelColumn('', [[0, 0]], { escX: 0 }) },
	{ id: 'stub-too-long', run: () => attachLabelColumn('SIG', [[0, 0]], { side: 'left', escX: -100, stub: 80 }) },
	{ id: 'gnd-clearance', run: () => gndStub([0, 0], { dir: 'down', len: 5 }) },
	{ id: 'power-empty-net', run: () => powerStub('', [0, 0], {}) },
	{ id: 'attr-gap-too-small', run: () => attributeAnchor({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { gap: 1 }) },
	{ id: 'assert-orth-detects-diagonal', run: () => assertOrthogonalWires([{ net: 'D', line: [0, 0, 10, 10] }]) },
	{
		id: 'assert-detects-floating-label',
		run: () => assertLabelsAttached([{ net: 'A', line: [0, 0, 40, 0] }], [{ kind: 'sig', net: 'A', x: 999, y: 999 }]),
	},
];

function runNegative(findings, checks) {
	const missed = [];
	for (const c of NEGATIVE_CASES) {
		let threw = false;
		try {
			c.run();
		} catch {
			threw = true;
		}
		if (!threw) {
			missed.push(c.id);
			findings.push({ rule: 'CH-negative-not-enforced', severity: 'hard', category: 'cell-helper',
				msg: `cell helper constraint regressed: '${c.id}' no longer throws on bad input`, where: { case: c.id } });
		}
	}
	checks.negative = { expected: NEGATIVE_CASES.length, enforced: NEGATIVE_CASES.length - missed.length, missed };
}

/* 互锁/区域 helper 的快速自检（不进 geomQC，纯逻辑） */
function runRegion(findings, checks) {
	const a = moduleRect({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 10);
	const b = regionOf([[200, 0], [300, 100]], 10);
	const overlap = rectsOverlap(a, b);
	/* elbow 必须把对角端点转成合法正交折线 */
	let elbowOrthogonal = 'pass';
	try {
		assertOrthogonalWires([wire('E', elbow([0, 0], [60, 40]))]);
	} catch (e) {
		elbowOrthogonal = e.message;
		findings.push({ rule: 'CH-elbow-orthogonal', severity: 'hard', category: 'cell-helper',
			msg: 'elbow produced a non-orthogonal route', where: { error: e.message } });
	}
	checks.region = { padded: a, region: b, interlock: overlap, elbowOrthogonal };
	if (overlap) {
		findings.push({ rule: 'CH-region-interlock', severity: 'hard', category: 'cell-helper',
			msg: 'moduleRect/regionOf reported false interlock for disjoint regions', where: { a, b } });
	}
}

export function runCellHelpersGate() {
	const findings = [];
	const checks = {};
	try {
		runPositive(findings, checks);
		runNegative(findings, checks);
		runRegion(findings, checks);
	} catch (e) {
		findings.push({ rule: 'CH0-unhandled-error', severity: 'hard', category: 'cell-helper',
			msg: 'cell helper gate crashed', where: { error: e.message, stack: e.stack } });
	}
	const hard = findings.filter(f => f.severity === 'hard').length;
	return { pass: hard === 0, severity: { hard, soft: 0, info: 0 }, checks, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = runCellHelpersGate();
	const report = {
		generatedAt: new Date().toISOString(),
		mode: 'local-only',
		root: resolve(ROOT),
		...result,
	};
	writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
	console.log(`cell helpers ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard} `
		+ `positiveLabelHard=${report.checks.positive?.labelHard ?? '?'} `
		+ `negativeEnforced=${report.checks.negative?.enforced}/${report.checks.negative?.expected}`);
	console.log(`report -> ${REPORT}`);
	process.exit(report.pass ? 0 : 1);
}

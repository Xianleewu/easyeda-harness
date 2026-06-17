// 示例 pack 独立 smoke：证明 examples/divider 的 cell builder（完全基于
// engine/cell_helpers.mjs）能产出通过真实 geomQC + labelQC 的几何，hard=0。
// 这是 handoff「新项目 fixture」要求的可执行证据：工作流不只是单一原理图的回归器。
// divider 是 circuit_packs 中注册的第二个真实电路族（非 AIHWDEBUGER）。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toWorld, withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { assemble } from './assemble.mjs';
import { validateProjectGeometry } from './project_geometry_gate.mjs';
import { validateLabelLayout } from './project_label_layout_gate.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from './cell_helpers.mjs';
import { dividerCell } from '../circuit_packs/divider/pack.mjs';

/* 端到端泛化回归：用注册的 divider pack + 库快照 + assembly 组装完整模型，
 * 跑真实 project 几何/标签门禁，断言 hard=0。锁定本会话的泛化突破，
 * 防止引擎/规则改动让非 aihwdebugger 项目静默回退。 */
function runDividerProjectGates(findings, checks) {
	try {
		const dir = `${ROOT}/samples/divider`;
		const read = name => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8').replace(/^﻿/, ''));
		const snap = read('project_library_snapshot.json');
		const assembly = read('project_assembly.json');
		const contract = read('project_contract.json');
		const byDes = new Map((snap.components || []).map(c => [c.designator, withLocalPins(c)]));
		const model = assemble(byDes, null, assembly);
		const geomHard = (validateProjectGeometry(model, {}).findings || []).filter(f => f.severity === 'hard');
		const labelHard = (validateLabelLayout({ assembly, contract, snap: model, liveMode: false }).findings || []).filter(f => f.severity === 'hard');
		checks.dividerProject = {
			components: (model.components || []).length,
			wires: (model.wires || []).length,
			geometryHard: geomHard.length,
			labelHard: labelHard.length,
		};
		if (geomHard.length) findings.push({ rule: 'DPS-project-geometry', severity: 'hard', category: 'example-pack',
			msg: 'assembled divider project model fails project geometry gate', where: { rules: geomHard.map(f => f.rule).slice(0, 8), first: geomHard[0] } });
		if (labelHard.length) findings.push({ rule: 'DPS-project-label', severity: 'hard', category: 'example-pack',
			msg: 'assembled divider project model fails project label gate', where: { rules: labelHard.map(f => f.rule).slice(0, 8), first: labelHard[0] } });
	} catch (e) {
		findings.push({ rule: 'DPS-project-unhandled', severity: 'hard', category: 'example-pack',
			msg: 'divider project-gate regression crashed', where: { error: e.message } });
	}
}

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const REPORT = process.env.EASYEDA_DIVIDER_SMOKE_REPORT || `${ROOT}/divider_pack_report.json`;

/* 合成电阻库件（带 .local 引脚与 localBox，模拟 normalize 后的库快照） */
function resistor(designator) {
	return {
		designator,
		pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
		localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
	};
}

/* 由 place + 库件构造世界坐标元件（引脚 + bbox），等价 buildmodel 的核心一步 */
function worldComponent(part, place) {
	const pins = (part.pins || []).map(p => {
		const [x, y] = toWorld(p.local, [place.x, place.y], place.rot, place.mirror);
		return { num: p.num, x, y };
	});
	const lb = part.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]]
		.map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	const xs = corners.map(c => c[0]);
	const ys = corners.map(c => c[1]);
	return {
		designator: part.designator,
		pins,
		bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
	};
}

export function runDividerPackSmoke() {
	const findings = [];
	const checks = {};
	try {
		const byDes = new Map([['R1', resistor('R1')], ['R2', resistor('R2')]]);
		const roles = { R_top: 'R1', R_bot: 'R2' };
		const A = { x: 1000, y: 1000 };
		const out = dividerCell(byDes, roles, A, { VIN: 'VIN', VMID: 'VMID' });

		let buildSelfCheck = 'pass';
		try {
			assertOrthogonalWires(out.wires);
			assertLabelsAttached(out.wires, out.flags);
		} catch (e) {
			buildSelfCheck = e.message;
			findings.push({ rule: 'DPS-selfcheck', severity: 'hard', category: 'example-pack',
				msg: 'divider cell output failed build-time self check', where: { error: e.message } });
		}

		const model = {
			components: [
				worldComponent(byDes.get('R1'), out.place.R1),
				worldComponent(byDes.get('R2'), out.place.R2),
			],
			wires: out.wires,
			netflags: out.flags,
		};
		const g = geomQC(model);
		const labelHard = labelQC(model).filter(f => f.severity === 'hard');
		checks.divider = {
			buildSelfCheck,
			wires: out.wires.length,
			flags: out.flags.length,
			geom: { overlaps: g.overlaps.length, wireThruComp: g.wireThruComp.length, offgrid: g.offgrid, crossings: g.crossings },
			labelHard: labelHard.length,
			labelRules: labelHard.map(f => f.rule),
		};
		if (g.overlaps.length || g.wireThruComp.length || g.offgrid || g.crossings) {
			findings.push({ rule: 'DPS-geometry', severity: 'hard', category: 'example-pack',
				msg: 'divider module fails geometry QC', where: { geom: checks.divider.geom, samples: { overlaps: g.overlaps.slice(0, 5), wireThruComp: g.wireThruComp.slice(0, 5), cross: g.crossEx.slice(0, 5) } } });
		}
		if (labelHard.length) {
			findings.push({ rule: 'DPS-label', severity: 'hard', category: 'example-pack',
				msg: 'divider module fails label QC', where: { rules: labelHard.map(f => f.rule), first: labelHard[0] } });
		}
		runDividerProjectGates(findings, checks);
	} catch (e) {
		findings.push({ rule: 'DPS0-unhandled', severity: 'hard', category: 'example-pack',
			msg: 'divider pack smoke crashed', where: { error: e.message, stack: e.stack } });
	}
	const hard = findings.filter(f => f.severity === 'hard').length;
	return { pass: hard === 0, severity: { hard, soft: 0, info: 0 }, checks, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = runDividerPackSmoke();
	const report = { generatedAt: new Date().toISOString(), mode: 'local-only', root: resolve(ROOT), ...result };
	writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
	console.log(`divider pack smoke ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard} `
		+ `geomCrossings=${report.checks.divider?.geom?.crossings ?? '?'} labelHard=${report.checks.divider?.labelHard ?? '?'}`);
	console.log(`report -> ${REPORT}`);
	process.exit(report.pass ? 0 : 1);
}

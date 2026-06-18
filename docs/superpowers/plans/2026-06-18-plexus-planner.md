# Plexus layout_planner 通用驱动(第一刀)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `engine/plexus_planner.mjs` 的 `planLayout({contract,byDes,opts})`:把 design_contract 模块区落成 archetype cell、按列×纵序定位、合并成模型,无 archetype/缺件的模块进 `skipped`(不静默丢),并用真实 geomQC/labelQC 证明组装模型 hard=0。

**Architecture:** 纯函数驱动。逐模块(按 `region.col` 分列、列内按 `region.row` 排序):`getArchetype(role)` 取原型(无则跳过)、从 `byDes` 取零件(缺则跳过)、anchor=(列 x, 列内游标 y)、`renderArchetype` 渲染、用模块**真实几何范围**(组件 bbox+线顶点+标点,含桩)累进列游标杜绝重叠、合并成 `model{components,wires,netflags}`。与现有 `engine/assemble.mjs`(AIHWDEBUGER 耦合)解耦。

**Tech Stack:** Node.js ESM(`.mjs`)、`node:test`。复用 `engine/transform.mjs`(`toWorld`)、`circuit_packs/archetypes/registry.mjs`(`getArchetype`/`renderArchetype`)、`engine/geom_qc.mjs`、`engine/label_qc.mjs`。无新依赖。

## Global Constraints

- ESM `.mjs`,纯函数,确定性(无 `Date.now`/`Math.random`;模块按 col 升序、列内 row 升序处理 → placed/skipped 确定)。
- 与生成轨道解耦:**不** import `engine/assemble.mjs` / `project_assembly.json` 机制。
- 数据形状(只读):`contract`(`synthesizeContract` 产物)`modules:[{id,role,column,parts:[ref],region:{col,row,wCells,hCells}}]`、`labelColumns:[{id,net,module,side,routeEnd,class}]`;`byDes` 为 `Map<designator,{designator,pins:[{num,local}],localBox}>`;`toWorld(local,[x,y],rot,mirror)`;`renderArchetype(role,{parts,anchor,nets})→{place,wires,flags,noConnects,region}`;`geomQC(model)→{overlaps,wireThruComp,offgrid,crossings}`;`labelQC(model)→[{…,severity}]`;`model={components:[{designator,pins:[{num,x,y}],bbox}],wires,netflags}`。
- fail-closed:无 archetype → `skipped{reason:'no-archetype'}`;缺件 → `skipped{reason:'missing-parts'}`;不静默丢模块。
- 间距用模块真实几何范围(含 power/gnd/标签桩),**不**用 `cell.region`(Slice 2 已知:region 不含桩)。
- 测试:中文用例名;并入现有 62 绿,零回归(`node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs` 全绿;`npm test` 100/100 不变)。
- Git:在功能分支 `feat/plexus-planner` 上执行(勿用 main 直接落任务提交)。逐任务提交**只 `git add` 本任务文件**;绝不 `git add -A`/`.`;提交后 `git show --stat HEAD` 自验文件数。不 push、不开 PR。

---

### Task 1: planLayout 驱动 + 单测

**Files:**
- Create: `engine/plexus_planner.mjs`
- Test: `engine/plexus_planner.test.mjs`

**Interfaces:**
- Consumes: `toWorld` from `./transform.mjs`;`getArchetype, renderArchetype` from `../circuit_packs/archetypes/registry.mjs`。
- Produces: `planLayout({contract, byDes, opts?}) -> { model:{components,wires,netflags}, placed:[moduleId], skipped:[{module,reason}] }`。`opts = { origin?:{x,y}=({x:1000,y:1000}), colWidth?=400, rowGap?=120, endpointNets?:{[moduleId]:{top?:{name,class},bottom?:{name,class}}} }`。

- [ ] **Step 1: 写失败测试** —— 创建 `engine/plexus_planner.test.mjs`

```javascript
// plexus_planner 单测:contract→placement 通用驱动(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLayout } from './plexus_planner.mjs';

const passive = d => ({
	designator: d,
	pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
	localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
});
const byDes = new Map([['R1', passive('R1')], ['R2', passive('R2')], ['R3', passive('R3')], ['R4', passive('R4')]]);

// 合成 contract:col0 两个 support 模块(纵向堆叠)+ col2 一个 controller(无 archetype)+ col0 一个缺件 support。
const contract = {
	schemaVersion: 1,
	grid: { colPitch: 10, rowPitch: 10 },
	columns: [
		{ id: 'input', role: 'in', order: 0, modules: ['m0', 'm1', 'm9'] },
		{ id: 'control', role: 'ctl', order: 2, modules: ['mctrl'] },
	],
	modules: [
		{ id: 'm0', role: 'support', column: 'input', parts: ['R1', 'R2'], region: { col: 0, row: 0, wCells: 3, hCells: 4 } },
		{ id: 'm1', role: 'support', column: 'input', parts: ['R3', 'R4'], region: { col: 0, row: 10, wCells: 3, hCells: 4 } },
		{ id: 'm9', role: 'support', column: 'input', parts: ['R99'], region: { col: 0, row: 20, wCells: 3, hCells: 3 } },
		{ id: 'mctrl', role: 'controller', column: 'control', parts: ['U1'], region: { col: 2, row: 0, wCells: 6, hCells: 5 } },
	],
	labelColumns: [
		{ id: 'NET_A@m0', net: 'NET_A', module: 'm0', side: 'right', routeEnd: 'from', class: 'signal' },
		{ id: 'NET_B@m1', net: 'NET_B', module: 'm1', side: 'right', routeEnd: 'from', class: 'signal' },
	],
	meta: { controller: 'U1', moduleCount: 4, columnCount: 2 },
};
const opts = {
	endpointNets: {
		m0: { top: { name: 'V5', class: 'power' }, bottom: { name: 'GND', class: 'ground' } },
		m1: { top: { name: 'V5', class: 'power' }, bottom: { name: 'GND', class: 'ground' } },
	},
};
const r = planLayout({ contract, byDes, opts });

test('planner:有 archetype 且零件齐的模块被 placed', () => {
	assert.deepEqual(r.placed.slice().sort(), ['m0', 'm1']);
});

test('planner:无 archetype 的模块进 skipped(no-archetype)', () => {
	const s = r.skipped.find(x => x.module === 'mctrl');
	assert.ok(s && s.reason === 'no-archetype');
});

test('planner:缺件的模块进 skipped(missing-parts)', () => {
	const s = r.skipped.find(x => x.module === 'm9');
	assert.ok(s && s.reason === 'missing-parts');
});

test('planner:model 含两模块全部组件/线/标', () => {
	assert.equal(r.model.components.length, 4);   // m0(R1,R2) + m1(R3,R4)
	assert.ok(r.model.wires.length > 0);
	assert.ok(r.model.netflags.length > 0);
});

test('planner:确定性(同输入两次 model 深相等)', () => {
	assert.deepEqual(planLayout({ contract, byDes, opts }).model, planLayout({ contract, byDes, opts }).model);
});

test('planner:负例(畸形 contract / byDes 非 Map)抛错', () => {
	assert.throws(() => planLayout({ contract: {}, byDes }));
	assert.throws(() => planLayout({ contract, byDes: {} }));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/plexus_planner.test.mjs`
Expected: FAIL —— `Cannot find module './plexus_planner.mjs'`。

- [ ] **Step 3: 写实现** —— 创建 `engine/plexus_planner.mjs`

```javascript
// Plexus 布局驱动:design_contract 模块区 → archetype cell → 组装模型(纯函数,与生成轨道解耦)。
import { toWorld } from './transform.mjs';
import { getArchetype } from '../circuit_packs/archetypes/registry.mjs';

const DEF = { origin: { x: 1000, y: 1000 }, colWidth: 400, rowGap: 120 };

/* 由 place + 库件构造世界坐标元件(引脚 + bbox),等价 buildmodel 核心一步 */
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

/* 模块真实几何范围(含桩):组件 bbox 角点 + 线顶点 + 标点。不用 cell.region(不含桩)。 */
function cellExtentMinY(worldComps, cell) {
	const ys = [];
	for (const c of worldComps) ys.push(c.bbox.minY, c.bbox.maxY);
	for (const w of cell.wires || []) {
		const l = w.line || [];
		for (let i = 1; i < l.length; i += 2) ys.push(l[i]);
	}
	for (const f of cell.flags || []) ys.push(f.y);
	return Math.min(...ys);
}

export function planLayout({ contract, byDes, opts = {} } = {}) {
	if (!contract || !Array.isArray(contract.modules)) {
		throw new TypeError('planLayout: contract.modules required');
	}
	if (!(byDes instanceof Map)) {
		throw new TypeError('planLayout: byDes must be a Map');
	}
	const o = { ...DEF, ...opts, origin: { ...DEF.origin, ...(opts.origin || {}) } };

	const sideByModule = new Map();
	for (const lc of contract.labelColumns || []) {
		if (lc.class === 'signal' && !sideByModule.has(lc.module)) sideByModule.set(lc.module, lc);
	}

	const cols = new Map();
	for (const m of contract.modules) {
		if (!cols.has(m.region.col)) cols.set(m.region.col, []);
		cols.get(m.region.col).push(m);
	}

	const placed = [];
	const skipped = [];
	const components = [];
	const wires = [];
	const netflags = [];

	for (const col of [...cols.keys()].sort((a, b) => a - b)) {
		const mods = cols.get(col).slice().sort((a, b) => a.region.row - b.region.row);
		const colX = o.origin.x + col * o.colWidth;
		let cursorY = o.origin.y;
		for (const m of mods) {
			let fn;
			try {
				fn = getArchetype(m.role);
			} catch {
				skipped.push({ module: m.id, reason: 'no-archetype' });
				continue;
			}
			const parts = [];
			let missing = false;
			for (const ref of m.parts) {
				const p = byDes.get(ref);
				if (!p) { missing = true; break; }
				parts.push(p);
			}
			if (missing) {
				skipped.push({ module: m.id, reason: 'missing-parts' });
				continue;
			}
			const nets = {};
			const side = sideByModule.get(m.id);
			if (side) nets.side = { name: side.net, class: 'signal' };
			const ep = (o.endpointNets || {})[m.id] || {};
			if (ep.top) nets.top = ep.top;
			if (ep.bottom) nets.bottom = ep.bottom;

			const cell = fn({ parts, anchor: { x: colX, y: cursorY }, nets });
			const wcs = parts.map(p => worldComponent(p, cell.place[p.designator]));
			cursorY = cellExtentMinY(wcs, cell) - o.rowGap;

			components.push(...wcs);
			wires.push(...(cell.wires || []));
			netflags.push(...(cell.flags || []));
			placed.push(m.id);
		}
	}

	return { model: { components, wires, netflags }, placed, skipped };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test engine/plexus_planner.test.mjs`
Expected: PASS（6 个用例)。若某用例失败,先停下报告实际输出。

- [ ] **Step 5: 提交**

```bash
git add engine/plexus_planner.mjs engine/plexus_planner.test.mjs
git commit -m "feat: add plexus_planner contract-to-placement driver with skip reporting"
```
提交后 `git show --stat HEAD` 确认恰这 2 文件。

---

### Task 2: 真实 geomQC/labelQC 组装断言 + 全量回归

**Files:**
- Modify: `engine/plexus_planner.test.mjs`(追加 import + 一个 geom/label 断言测试)

**Interfaces:**
- Consumes: `planLayout`(Task 1);`geomQC` from `./geom_qc.mjs`;`labelQC` from `./label_qc.mjs`。
- Produces: 一个断言 `planLayout` 组装出的 model 过真实 geomQC(overlaps/wireThruComp/offgrid/crossings=0)+ labelQC(hard=0)的测试。

- [ ] **Step 1: 写失败测试** —— 在 `engine/plexus_planner.test.mjs` 顶部 import 区追加

```javascript
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
```

并在文件末尾追加:

```javascript
test('planner:组装 model 过真实 geomQC/labelQC hard=0', () => {
	const g = geomQC(r.model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	const labelHard = labelQC(r.model).filter(f => f.severity === 'hard');
	assert.deepEqual(labelHard, [], 'labelQC hard');
});
```

(`r` 是 Task 1 测试文件顶部已计算的 `planLayout({contract,byDes,opts})` 结果,直接复用。)

- [ ] **Step 2: 跑测试确认通过**

Run: `node --test engine/plexus_planner.test.mjs`
Expected: PASS（7 个用例,含 geom/label 断言)。
**若 geomQC 某项非 0 或 labelQC 有 hard,停下报告实际数值**(说明两个 support 模块在 col0 纵向堆叠时桩相撞或越界),不要改阈值绕过——必要时调大 `DEF.rowGap` 并在报告里说明。

- [ ] **Step 3: 全量回归(把实际输出行写进报告)**

Run: `node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs`
Expected: `fail 0`;记录末尾 `tests`/`pass`/`fail` 计数(应为 62 + 7 = 69)。

Run: `npm test`
Expected: `Fast Template Harness | Score 100/100 | PASS`;记录该行。

- [ ] **Step 4: 提交**

```bash
git add engine/plexus_planner.test.mjs
git commit -m "test: prove planner-assembled model passes geomQC/labelQC hard=0"
```
提交后 `git show --stat HEAD` 确认恰这 1 文件。

---

## Self-Review

**1. Spec coverage:**
- contract→placement 驱动(spec §3/§4)→ Task 1 `planLayout`。✓
- 逐列游标 + 真实几何范围杜绝重叠(spec §5)→ Task 1 `cellExtentMinY` + cursor。✓
- side 取自 labelColumns、top/bottom 取自 opts.endpointNets(spec §4/§5)→ Task 1。✓
- fail-closed skip(no-archetype / missing-parts)(spec §6)→ Task 1 + 单测断言。✓
- 真实 geomQC/labelQC hard=0(spec §7)→ Task 2。✓
- 确定性 + 负例(spec §7/§10)→ Task 1 单测。✓
- 解耦(不用 assemble.mjs)(spec §2)→ Task 1 仅 import transform + registry。✓
- 文件清单(spec §9)→ Task 1/2。✓

**2. Placeholder scan:** 无 TBD/TODO;每代码步含完整代码;`cellExtentMinY` 显式只取 y 最小(游标只需向下推),含组件/线/标 y,故含桩。✓

**3. Type consistency:** `planLayout({contract,byDes,opts})→{model,placed,skipped}` 跨任务一致;`worldComponent`/`cellExtentMinY` 命名一致;测试夹具 `passive`/`byDes`/`contract`/`opts`/`r` 在 Task 1 定义并被 Task 2 复用;`model.{components,wires,netflags}` 字段与 geomQC/labelQC 输入一致。✓

## Execution Handoff

见对话:计划保存后转入 subagent-driven-development 执行。

# Plexus planner 摆放格对齐(slice 5)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** planner 给每个模块 `anchor.y` 量化到格,修复真实零件分数 localBox 导致的 `geomQC.offgrid` 离格(实测 68→0)。

**Architecture:** `engine/plexus_planner.mjs` 加本地 `snapGrid`,模块 anchor.y 用 `snapGrid(cursorY)`;游标推进不变。格锚点 + 格 local 引脚 = 格几何。

**Tech Stack:** Node.js ESM、`node:test`。

## Global Constraints
- 纯函数,确定性;不新增 import(本地 snapGrid 保持解耦)。
- 对已格对齐输入幂等(现有 8 planner 用例零回归)。
- 测试中文用例名;并入现有 78 绿零回归;`npm test` 100/100。
- Git:分支 `feat/plexus-gridsnap`;提交只 `git add engine/plexus_planner.mjs engine/plexus_planner.test.mjs`;绝不 `-A`/`.`;`git show --stat HEAD` 自验;不 push。

---

### Task 1: anchor.y 格对齐 + 测试

**Files:**
- Modify: `engine/plexus_planner.mjs`
- Test: `engine/plexus_planner.test.mjs`

**Interfaces:** `planLayout` 行为不变,仅 anchor.y 量化到格(对外签名不变)。

- [ ] **Step 1: 写失败测试** —— 在 `engine/plexus_planner.test.mjs` 末尾追加(`geomQC` 已在前序计划 Task 2 的顶部 import,直接复用;勿重复 import)

```javascript
test('planner:分数 localBox 件 → 引脚仍全格对齐、offgrid=0', () => {
	// 模拟真实件:local 引脚格对齐,但 localBox 分数(.5)。
	const fpassive = d => ({
		designator: d,
		pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
		localBox: { minX: -10.5, minY: -5.5, maxX: 10.5, maxY: 5.5 },
	});
	const bd = new Map([['F1', fpassive('F1')], ['F2', fpassive('F2')], ['F3', fpassive('F3')], ['F4', fpassive('F4')]]);
	const ct = {
		schemaVersion: 1, grid: { colPitch: 10, rowPitch: 10 },
		columns: [{ id: 'input', role: 'in', order: 0, modules: ['a', 'b'] }],
		modules: [
			{ id: 'a', role: 'support', column: 'input', parts: ['F1', 'F2'], region: { col: 0, row: 0, wCells: 3, hCells: 4 } },
			{ id: 'b', role: 'support', column: 'input', parts: ['F3', 'F4'], region: { col: 0, row: 10, wCells: 3, hCells: 4 } },
		],
		labelColumns: [], meta: { controller: null, moduleCount: 2, columnCount: 1 },
	};
	const rr = planLayout({ contract: ct, byDes: bd });
	for (const c of rr.model.components) {
		for (const p of c.pins) {
			assert.equal(p.x % 10, 0, `pin ${c.designator}.${p.num} x off-grid: ${p.x}`);
			assert.equal(p.y % 10, 0, `pin ${c.designator}.${p.num} y off-grid: ${p.y}`);
		}
	}
	assert.equal(geomQC(rr.model).offgrid, 0, 'offgrid');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/plexus_planner.test.mjs`
Expected: FAIL —— 第二个模块 `b` 的引脚因分数 localBox 推出的分数 anchor.y 而离格(`p.y % 10 !== 0` 或 `offgrid !== 0`)。
若报 `geomQC is not defined`,在顶部 import 区补 `import { geomQC } from './geom_qc.mjs';`(前序计划 Task 2 已加入,通常已存在)。

- [ ] **Step 3: 写实现** —— 改 `engine/plexus_planner.mjs`

文件顶部常量区(`const DEF = ...` 附近)加:
```javascript
const GRID = 10;
const snapGrid = v => Math.round(v / GRID) * GRID;
```

逐模块循环里把渲染调用的 anchor.y 改为 snap 后的值。当前:
```javascript
			const cell = fn({ parts, anchor: { x: colX, y: cursorY }, nets });
```
改为:
```javascript
			const cell = fn({ parts, anchor: { x: colX, y: snapGrid(cursorY) }, nets });
```
(游标推进 `cursorY = cellExtentMinY(wcs, cell) - o.rowGap` 不变 —— 下一轮再 snap。)

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `node --test engine/plexus_planner.test.mjs`
Expected: PASS（原 8 + 新 1 = 9 个用例)。
Run: `node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs`
Expected: `fail 0`,计数 79;记录进报告。
Run: `npm test`
Expected: `Fast Template Harness | Score 100/100 | PASS`;记录进报告。

- [ ] **Step 5: 提交**

```bash
git add engine/plexus_planner.mjs engine/plexus_planner.test.mjs
git commit -m "fix: grid-snap planner module anchors so real fractional-bbox parts stay on-grid"
```
`git show --stat HEAD` 确认恰 2 文件。

---

## Self-Review

- 修法(spec §2)→ Task 1 snapGrid + anchor.y。✓
- 测试分数-localBox 格对齐 + offgrid=0(spec §3)→ Task 1。✓
- 幂等零回归(spec §3)→ Step 4 全量回归。✓
- 文件清单(spec §4)→ Task 1。✓
- 无占位;snapGrid 完整;现有 anchor 已格对齐故 snap 幂等。✓

## Execution Handoff
见对话:subagent-driven 执行 + 真实 live.json 探针手验 offgrid 68→0。

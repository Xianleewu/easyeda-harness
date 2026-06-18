# Plexus support 端点 net 派生(slice 7)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** `deriveSupportEndpoints(parts, logical)` 取 support 模块两端网,接进 planLayout,让真实图上单件无源模块带电源/地桩。

**Architecture:** `net_derive.mjs` 加 `netOfPin`+`deriveSupportEndpoints`(`derivePinNets` 复用 netOfPin);planLayout 带 logical 时补 `nets.top/bottom`(opts.endpointNets 优先)。

**Tech Stack:** Node.js ESM、`node:test`。

## Global Constraints
- 纯函数,确定性;planLayout 不传 logical 行为不变(现有 10 planner 用例零回归)。
- 测试中文用例名;并入现有 83 绿零回归;`npm test` 100/100。
- Git:分支 `feat/plexus-support-ep`;Task 1 只 `git add engine/net_derive.mjs engine/net_derive.test.mjs`;Task 2 只 `git add engine/plexus_planner.mjs engine/plexus_planner.test.mjs`;每次 `git show --stat HEAD` 自验恰 2 文件;绝不 `-A`/`.`;不 push。

---

### Task 1: deriveSupportEndpoints + netOfPin 重构 + 单测

**Files:** Modify `engine/net_derive.mjs`、`engine/net_derive.test.mjs`

- [ ] **Step 1: 写失败测试** —— `engine/net_derive.test.mjs` 顶部 import 加 `deriveSupportEndpoints`,末尾追加:

```javascript
test('net_derive:deriveSupportEndpoints 取首件 pin2(top)、末件 pin1(bottom)', () => {
	const parts = [{ designator: 'R1' }, { designator: 'R2' }];
	const lg = { nets: [
		{ name: 'V5', class: 'power', pins: ['R1.2'] },
		{ name: 'GND', class: 'ground', pins: ['R2.1'] },
	] };
	assert.deepEqual(deriveSupportEndpoints(parts, lg), { top: { name: 'V5', class: 'power' }, bottom: { name: 'GND', class: 'ground' } });
});

test('net_derive:deriveSupportEndpoints 单件取 pin2/pin1;空 parts 空对象', () => {
	const lg = { nets: [
		{ name: 'V3V3', class: 'power', pins: ['C1.2'] },
		{ name: 'GND', class: 'ground', pins: ['C1.1'] },
	] };
	assert.deepEqual(deriveSupportEndpoints([{ designator: 'C1' }], lg), { top: { name: 'V3V3', class: 'power' }, bottom: { name: 'GND', class: 'ground' } });
	assert.deepEqual(deriveSupportEndpoints([], lg), {});
});
```
(导入行改为 `import { derivePinNets, deriveSupportEndpoints } from './net_derive.mjs';`。)

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/net_derive.test.mjs`
Expected: FAIL —— `deriveSupportEndpoints is not a function`。

- [ ] **Step 3: 写实现** —— 用以下完整内容替换 `engine/net_derive.mjs`

```javascript
// 网派生(纯函数):器件引脚 → 其所在网的名+类。
function netOfPin(designator, num, logical) {
	const key = `${designator}.${num}`;
	const net = ((logical && logical.nets) || []).find(n => (n.pins || []).includes(key));
	return net ? { name: net.name, class: net.class } : null;
}

// 多引脚器件:每个引脚 → 网+类(fanout 用)。未连引脚不收。
export function derivePinNets(component, logical) {
	const out = {};
	const pins = (component && component.pins) || [];
	const des = component && component.designator;
	for (const p of pins) {
		const net = netOfPin(des, p.num, logical);
		if (net) out[String(p.num)] = net;
	}
	return out;
}

// support 链:首件 pin2(顶)、末件 pin1(底)→ 端点网+类(support 用)。
export function deriveSupportEndpoints(parts, logical) {
	if (!Array.isArray(parts) || !parts.length) return {};
	const out = {};
	const top = netOfPin(parts[0].designator, '2', logical);
	const bottom = netOfPin(parts[parts.length - 1].designator, '1', logical);
	if (top) out.top = top;
	if (bottom) out.bottom = bottom;
	return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test engine/net_derive.test.mjs`
Expected: PASS（原 3 + 新 2 = 5 个用例;`derivePinNets` 行为不变)。

- [ ] **Step 5: 提交**

```bash
git add engine/net_derive.mjs engine/net_derive.test.mjs
git commit -m "feat: add deriveSupportEndpoints (chain top/bottom nets) via shared netOfPin"
```
`git show --stat HEAD` 确认恰 2 文件。

---

### Task 2: planLayout 补 support 端点

**Files:** Modify `engine/plexus_planner.mjs`、`engine/plexus_planner.test.mjs`

- [ ] **Step 1: 写失败测试** —— `engine/plexus_planner.test.mjs` 末尾追加

```javascript
test('planner:单件 support + logical → 出电源/地桩;不传则裸件', () => {
	const cap = {
		designator: 'C1',
		pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
		localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
	};
	const bd = new Map([['C1', cap]]);
	const ct = {
		schemaVersion: 1, grid: { colPitch: 10, rowPitch: 10 },
		columns: [{ id: 'input', role: 'in', order: 0, modules: ['s'] }],
		modules: [{ id: 's', role: 'support', column: 'input', parts: ['C1'], region: { col: 0, row: 0, wCells: 3, hCells: 3 } }],
		labelColumns: [], meta: { controller: null, moduleCount: 1, columnCount: 1 },
	};
	const lg = { nets: [
		{ name: 'V5', class: 'power', pins: ['C1.2'] },
		{ name: 'GND', class: 'ground', pins: ['C1.1'] },
	] };
	const withLog = planLayout({ contract: ct, byDes: bd, logical: lg });
	assert.ok(withLog.model.wires.length > 0, 'wires with logical');
	assert.ok(withLog.model.netflags.length > 0, 'flags with logical');
	const g = geomQC(withLog.model);
	assert.equal(g.overlaps.length + g.wireThruComp.length + g.offgrid + g.crossings, 0, 'geom clean');

	const noLog = planLayout({ contract: ct, byDes: bd });
	assert.equal(noLog.model.wires.length, 0, 'no wires without logical (backward compat)');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/plexus_planner.test.mjs`
Expected: FAIL —— 带 logical 但无 top/bottom 派生,单件 support 无桩 → `withLog.model.wires.length > 0` 失败。

- [ ] **Step 3: 写实现** —— 改 `engine/plexus_planner.mjs`

import 行改为:
```javascript
import { derivePinNets, deriveSupportEndpoints } from './net_derive.mjs';
```
在逐模块 `nets` 构造里,`if (parts.length === 1 && logical) { nets.pinNets = ... }` 之后加:
```javascript
			if (logical) {
				const sep = deriveSupportEndpoints(parts, logical);
				if (!nets.top && sep.top) nets.top = sep.top;
				if (!nets.bottom && sep.bottom) nets.bottom = sep.bottom;
			}
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `node --test engine/plexus_planner.test.mjs` → PASS(原 10 + 新 1 = 11)。
Run: `node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs` → `fail 0`,计数 86(83 + net_derive 2 + planner 1);记录。
Run: `npm test` → `Score 100/100 | PASS`;记录。

- [ ] **Step 5: 提交**

```bash
git add engine/plexus_planner.mjs engine/plexus_planner.test.mjs
git commit -m "feat: planLayout derives support endpoint power/ground stubs from logical"
```
`git show --stat HEAD` 确认恰 2 文件。

---

## Self-Review
- deriveSupportEndpoints + netOfPin 重构(spec §2)→ Task 1;planLayout 集成(spec §2)→ Task 2;向后兼容→ Task 2 noLog 断言;测试(spec §3)→ Task 1/2;文件清单(spec §4)→ Task 1/2。✓
- 无占位;`derivePinNets` 重构后行为不变(现有 net_derive 测试零回归);planLayout opts.endpointNets 优先(`!nets.top` 守卫)。✓

## Execution Handoff
见对话:subagent-driven + 真实 live.json 探针手验 support 出桩。

# Plexus 网派生 derivePinNets(slice 6)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 新增 `engine/net_derive.mjs` 的 `derivePinNets`(引脚→网+类),并接进 planLayout 让单件 fanout 模块在带 `logical` 时真正扇出。

**Architecture:** `derivePinNets(component, logical)` 纯查表;planLayout 加可选 `logical`,单件模块补 `nets.pinNets`,fanout 用/support 忽略;不传 logical 向后兼容。

**Tech Stack:** Node.js ESM、`node:test`。

## Global Constraints
- 纯函数,确定性;planLayout 仅新增 import `./net_derive.mjs`(解耦)。
- 不传 `logical` 时 planLayout 行为完全不变(现有 9 用例零回归)。
- 测试中文用例名;并入现有 79 绿零回归;`npm test` 100/100。
- Git:分支 `feat/plexus-netderive`;逐任务只 `git add` 本任务文件;绝不 `-A`/`.`;`git show --stat HEAD` 自验;不 push。

---

### Task 1: derivePinNets 纯函数 + 单测

**Files:**
- Create: `engine/net_derive.mjs`
- Test: `engine/net_derive.test.mjs`

**Interfaces:** `derivePinNets(component, logical) -> { [pinNum]: { name, class } }`。

- [ ] **Step 1: 写失败测试** —— 创建 `engine/net_derive.test.mjs`

```javascript
// net_derive 单测:引脚→网+类派生(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePinNets } from './net_derive.mjs';

const comp = { designator: 'J1', pins: [{ num: '1' }, { num: '2' }, { num: '3' }] };
const logical = {
	nets: [
		{ name: 'GND', class: 'ground', pins: ['J1.1', 'U1.5'] },
		{ name: 'D-', class: 'signal', pins: ['J1.2', 'U1.6'] },
		{ name: 'V5', class: 'power', pins: ['U2.1', 'C1.1'] },
	],
};

test('net_derive:引脚映射其网名+类;未连引脚不收', () => {
	const pn = derivePinNets(comp, logical);
	assert.deepEqual(pn['1'], { name: 'GND', class: 'ground' });
	assert.deepEqual(pn['2'], { name: 'D-', class: 'signal' });
	assert.ok(!('3' in pn));   // J1.3 未在任何网 → 不收
});

test('net_derive:空 pins / 无 nets → 空对象', () => {
	assert.deepEqual(derivePinNets({ designator: 'X', pins: [] }, logical), {});
	assert.deepEqual(derivePinNets(comp, {}), {});
});

test('net_derive:确定性', () => {
	assert.deepEqual(derivePinNets(comp, logical), derivePinNets(comp, logical));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/net_derive.test.mjs`
Expected: FAIL —— `Cannot find module './net_derive.mjs'`。

- [ ] **Step 3: 写实现** —— 创建 `engine/net_derive.mjs`

```javascript
// 网派生(纯函数):多引脚器件的每个引脚 → 其所在网的名+类。
// 用于 fanout 原型的 pinNets。未连引脚不收。

export function derivePinNets(component, logical) {
	const out = {};
	const pins = (component && component.pins) || [];
	const nets = (logical && logical.nets) || [];
	const des = component && component.designator;
	for (const p of pins) {
		const key = `${des}.${p.num}`;
		const net = nets.find(n => (n.pins || []).includes(key));
		if (net) out[String(p.num)] = { name: net.name, class: net.class };
	}
	return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test engine/net_derive.test.mjs`
Expected: PASS（3 个用例)。

- [ ] **Step 5: 提交**

```bash
git add engine/net_derive.mjs engine/net_derive.test.mjs
git commit -m "feat: add derivePinNets (pin-to-net mapping from netlist)"
```
`git show --stat HEAD` 确认恰 2 文件。

---

### Task 2: planLayout 集成 logical → pinNets

**Files:**
- Modify: `engine/plexus_planner.mjs`
- Test: `engine/plexus_planner.test.mjs`

**Interfaces:**
- Consumes: `derivePinNets` from `./net_derive.mjs`(Task 1)。
- Produces: `planLayout({contract, byDes, logical?, opts})`;单件模块且传 `logical` 时 `nets.pinNets = derivePinNets(parts[0], logical)`。

- [ ] **Step 1: 写失败测试** —— 在 `engine/plexus_planner.test.mjs` 末尾追加

```javascript
test('planner:单件 connector + logical → 扇出有线有标;不传 logical 则裸件', () => {
	// 6 脚连接器(脚 x=±30 体外、纵距 40),role=connector → fanout。
	const conn = {
		designator: 'J9',
		pins: [
			{ num: '1', local: [-30, -40] }, { num: '2', local: [-30, 0] }, { num: '3', local: [-30, 40] },
			{ num: '4', local: [30, -40] }, { num: '5', local: [30, 0] }, { num: '6', local: [30, 40] },
		],
		localBox: { minX: -15, minY: -55, maxX: 15, maxY: 55 },
	};
	const bd = new Map([['J9', conn]]);
	const ct = {
		schemaVersion: 1, grid: { colPitch: 10, rowPitch: 10 },
		columns: [{ id: 'input', role: 'in', order: 0, modules: ['c'] }],
		modules: [{ id: 'c', role: 'connector', column: 'input', parts: ['J9'], region: { col: 0, row: 0, wCells: 4, hCells: 6 } }],
		labelColumns: [], meta: { controller: null, moduleCount: 1, columnCount: 1 },
	};
	const lg = {
		nets: [
			{ name: 'GND', class: 'ground', pins: ['J9.1'] },
			{ name: 'USB_DN', class: 'signal', pins: ['J9.2'] },
			{ name: 'V5', class: 'power', pins: ['J9.3'] },
			{ name: 'TX', class: 'signal', pins: ['J9.4'] },
			{ name: 'RX', class: 'signal', pins: ['J9.5'] },
			{ name: 'V3V3', class: 'power', pins: ['J9.6'] },
		],
	};
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
Expected: FAIL —— 不传/传 logical 都无 pinNets,connector fanout 无桩 → `withLog.model.wires.length > 0` 失败。

- [ ] **Step 3: 写实现** —— 改 `engine/plexus_planner.mjs`

顶部 import 区加:
```javascript
import { derivePinNets } from './net_derive.mjs';
```
`planLayout` 签名解构加 `logical`:
```javascript
export function planLayout({ contract, byDes, logical, opts = {} } = {}) {
```
在逐模块构造 `nets` 处(`const nets = {}` 之后、调用 `fn` 之前),加:
```javascript
			if (parts.length === 1 && logical) {
				nets.pinNets = derivePinNets(parts[0], logical);
			}
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `node --test engine/plexus_planner.test.mjs` → PASS(原 9 + 新 1 = 10)。
Run: `node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs` → `fail 0`,计数 83(79 + net_derive 3 + planner 1);记录。
Run: `npm test` → `Score 100/100 | PASS`;记录。

- [ ] **Step 5: 提交**

```bash
git add engine/plexus_planner.mjs engine/plexus_planner.test.mjs
git commit -m "feat: planLayout derives fanout pinNets from logical netlist"
```
`git show --stat HEAD` 确认恰 2 文件。

---

## Self-Review
- derivePinNets(spec §2)→ Task 1;planLayout 集成(spec §2)→ Task 2;向后兼容(spec §2)→ Task 2 noLog 断言;测试(spec §5)→ Task 1/2;文件清单(spec §6)→ Task 1/2。✓
- 无占位;`derivePinNets` 完整;planLayout 仅为单件模块补 pinNets,fanout 用/support 忽略。✓
- 类型一致:`derivePinNets(component, logical)→{[num]:{name,class}}`;`planLayout({contract,byDes,logical,opts})`;`geomQC` 已在测试顶部 import。✓

## Execution Handoff
见对话:subagent-driven + 真实 live.json 探针手验 connector 扇出。

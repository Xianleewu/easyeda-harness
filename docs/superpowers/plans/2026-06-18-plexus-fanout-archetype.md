# Plexus fanout(多引脚扇出)archetype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `circuit_packs/archetypes/fanout.mjs` 的 `fanoutArchetype`:单个多引脚器件 → 摆放 + 每引脚按网类水平扇出标签/桩,注册给 `connector`,用真实 geomQC/labelQC 冒烟证明 hard=0。

**Architecture:** 纯函数。器件 rot 0 摆 anchor,逐引脚 `toWorld` 算世界坐标,按 `pinNets[num].class` 水平扇出(signal→labelStub、power→powerStub(dir=side)、ground→gndStub(dir=side)),side 由 `pin.local[0]` 正负定 → 杜绝堆叠引脚纵向相撞。完全用 `engine/cell_helpers.mjs` 构建。

**Tech Stack:** Node.js ESM(`.mjs`)、`node:test`。复用 `engine/transform.mjs`、`engine/cell_helpers.mjs`、`engine/geom_qc.mjs`、`engine/label_qc.mjs`、`circuit_packs/archetypes/registry.mjs`。

## Global Constraints

- ESM `.mjs`,纯函数,确定性(按 pins 顺序;无 `Date.now`/`Math.random`)。完全用 cell_helpers 构建几何,不手摆裸线/标。
- 数据形状(只读):多引脚器件 `{designator, pins:[{num,local:[x,y]}], localBox}`;`toWorld(local,[x,y],rot,mirror)`。
- side 规则:`pin.local[0] >= 0 → 'right'` 否则 `'left'`;`powerStub`/`gndStub` 用 `dir:side`(水平),`labelStub` 用 `side` + 显式 `escX = world[0] ± 30`。
- fail-closed:`parts` 非恰一个器件 / 器件无引脚 / `pinNets` 指向不存在引脚 → 抛错。
- 测试:中文用例名;并入现有 70 绿零回归(`node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs` 全绿;`npm test` 100/100)。
- Git:功能分支 `feat/plexus-fanout` 执行;逐任务**只 `git add` 本任务文件**;绝不 `-A`/`.`;提交后 `git show --stat HEAD` 自验。不 push。

---

### Task 1: fanoutArchetype + 单测

**Files:**
- Create: `circuit_packs/archetypes/fanout.mjs`
- Test: `circuit_packs/archetypes/fanout.test.mjs`

**Interfaces:**
- Consumes: `toWorld` from `../../engine/transform.mjs`;`labelStub, gndStub, powerStub, regionOf, mergeParts, assertOrthogonalWires, assertLabelsAttached` from `../../engine/cell_helpers.mjs`。
- Produces: `fanoutArchetype(spec) -> {place,wires,flags,noConnects,region}`,`spec={parts:[一个多引脚器件],anchor:{x,y},nets:{pinNets:{[num]:{name,class}}},opts}`。

- [ ] **Step 1: 写失败测试** —— 创建 `circuit_packs/archetypes/fanout.test.mjs`

```javascript
// fanout 角色原型单测:多引脚器件水平扇出(纯函数,基于 cell_helpers)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fanoutArchetype } from './fanout.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from '../../engine/cell_helpers.mjs';

// 合成双侧 6 脚连接器:左 x=-30(脚1/2/3 y=-40/0/40),右 x=+30(脚4/5/6 y=-40/0/40)。
// localBox x±15(脚 x=±30 在体外 → 桩不穿体);y±55 覆盖脚;纵向间距 40 > 标签净空。
function connector(designator) {
	return {
		designator,
		pins: [
			{ num: '1', local: [-30, -40] }, { num: '2', local: [-30, 0] }, { num: '3', local: [-30, 40] },
			{ num: '4', local: [30, -40] }, { num: '5', local: [30, 0] }, { num: '6', local: [30, 40] },
		],
		localBox: { minX: -15, minY: -55, maxX: 15, maxY: 55 },
	};
}
const anchor = { x: 1000, y: 1000 };
const pinNets = {
	'1': { name: 'GND', class: 'ground' },
	'2': { name: 'USB_DN', class: 'signal' },
	'3': { name: 'V5', class: 'power' },
	'4': { name: 'TX', class: 'signal' },
	'5': { name: 'RX', class: 'signal' },
	'6': { name: 'V3V3', class: 'power' },
};
const cell = fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets } });

test('fanout:器件 rot 0 摆 anchor', () => {
	assert.deepEqual(cell.place.J1, { x: 1000, y: 1000, rot: 0, mirror: false });
});

test('fanout:导线全正交、标签全附着', () => {
	assert.doesNotThrow(() => assertOrthogonalWires(cell.wires));
	assert.doesNotThrow(() => assertLabelsAttached(cell.wires, cell.flags));
});

test('fanout:各网类出对应桩(sig/power/gnd)', () => {
	const kinds = cell.flags.map(f => f.kind);
	assert.ok(kinds.includes('sig'));     // USB_DN/TX/RX
	assert.ok(kinds.includes('power'));   // V5/V3V3
	assert.ok(kinds.includes('gnd'));     // GND
	assert.equal(cell.flags.filter(f => f.kind === 'sig').length, 3);
});

test('fanout:region 覆盖所有引脚', () => {
	assert.ok(cell.region.minX < 970 && cell.region.maxX > 1030);
	assert.ok(cell.region.minY < 960 && cell.region.maxY > 1040);
});

test('fanout:确定性(同输入两次深相等)', () => {
	const a = fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets } });
	const b = fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets } });
	assert.deepEqual(a, b);
});

test('fanout:负例(空 parts/多器件/pinNets 指向不存在引脚)抛错', () => {
	assert.throws(() => fanoutArchetype({ parts: [], anchor, nets: { pinNets } }));
	assert.throws(() => fanoutArchetype({ parts: [connector('J1'), connector('J2')], anchor, nets: { pinNets } }));
	assert.throws(() => fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets: { '9': { name: 'X', class: 'signal' } } } }));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test circuit_packs/archetypes/fanout.test.mjs`
Expected: FAIL —— `Cannot find module './fanout.mjs'`。

- [ ] **Step 3: 写实现** —— 创建 `circuit_packs/archetypes/fanout.mjs`

```javascript
// 角色原型:fanout 多引脚器件水平扇出(连接器/枢纽)。完全用 cell_helpers 构建几何。
import { toWorld } from '../../engine/transform.mjs';
import { labelStub, gndStub, powerStub, regionOf, mergeParts } from '../../engine/cell_helpers.mjs';

export function fanoutArchetype(spec = {}) {
	const { parts, anchor, nets = {} } = spec;
	if (!Array.isArray(parts) || parts.length !== 1) {
		throw new Error('fanoutArchetype: spec.parts must be exactly one multi-pin component');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('fanoutArchetype: spec.anchor {x,y} required');
	}
	const comp = parts[0];
	const pins = comp.pins || [];
	if (!pins.length) throw new Error('fanoutArchetype: component has no pins');
	const pinNets = nets.pinNets || {};
	const pinNums = new Set(pins.map(p => String(p.num)));
	for (const num of Object.keys(pinNets)) {
		if (!pinNums.has(String(num))) {
			throw new Error(`fanoutArchetype: pinNets references missing pin ${num}`);
		}
	}

	const place = { [comp.designator]: { x: anchor.x, y: anchor.y, rot: 0, mirror: false } };
	const frags = [];
	const pts = [];
	for (const p of pins) {
		const world = toWorld(p.local, [anchor.x, anchor.y], 0, false);
		pts.push(world);
		const pn = pinNets[String(p.num)];
		if (!pn) continue;
		const side = p.local[0] >= 0 ? 'right' : 'left';
		if (pn.class === 'signal') {
			frags.push(labelStub(pn.name, world, { side, escX: world[0] + (side === 'right' ? 30 : -30) }));
		} else if (pn.class === 'power') {
			frags.push(powerStub(pn.name, world, { dir: side, len: 50 }));
		} else if (pn.class === 'ground') {
			frags.push(gndStub(world, { dir: side, len: 30, net: pn.name }));
		}
	}
	const merged = mergeParts(...frags);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test circuit_packs/archetypes/fanout.test.mjs`
Expected: PASS（6 个用例)。若失败,先停下报告实际输出,不要乱改。

- [ ] **Step 5: 提交**

```bash
git add circuit_packs/archetypes/fanout.mjs circuit_packs/archetypes/fanout.test.mjs
git commit -m "feat: add fanout archetype (multi-pin component horizontal fanout)"
```
提交后 `git show --stat HEAD` 确认恰 2 文件。

---

### Task 2: 注册 connector → fanout

**Files:**
- Modify: `circuit_packs/archetypes/registry.mjs`
- Test: `circuit_packs/archetypes/registry.test.mjs`

**Interfaces:**
- Consumes: `fanoutArchetype` from `./fanout.mjs`(Task 1)。
- Produces: `getArchetype('connector')` 返回 `fanoutArchetype`;`support` 不变。

- [ ] **Step 1: 写失败测试** —— 在 `circuit_packs/archetypes/registry.test.mjs` 顶部 import 区加 `import { fanoutArchetype } from './fanout.mjs';`,末尾追加:

```javascript
test('registry:getArchetype(connector) 返回 fanoutArchetype', () => {
	assert.equal(getArchetype('connector'), fanoutArchetype);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test circuit_packs/archetypes/registry.test.mjs`
Expected: FAIL —— `getArchetype('connector')` 抛错(未知 role),新断言失败。

- [ ] **Step 3: 写实现** —— 改 `circuit_packs/archetypes/registry.mjs`

顶部 import 区加:`import { fanoutArchetype } from './fanout.mjs';`
`ARCHETYPES` 表改为:`const ARCHETYPES = { support: supportArchetype, connector: fanoutArchetype };`

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test circuit_packs/archetypes/registry.test.mjs`
Expected: PASS（4 个用例)。

- [ ] **Step 5: 提交**

```bash
git add circuit_packs/archetypes/registry.mjs circuit_packs/archetypes/registry.test.mjs
git commit -m "feat: register connector role to fanout archetype"
```
提交后 `git show --stat HEAD` 确认恰 2 文件。

---

### Task 3: geomQC/labelQC 冒烟 + 全量回归

**Files:**
- Modify: `circuit_packs/archetypes/fanout.test.mjs`(追加 import + 冒烟测试)

**Interfaces:**
- Consumes: `fanoutArchetype`(Task 1);`toWorld`、`geomQC`、`labelQC`。
- Produces: 组装最小快照跑真实 geomQC/labelQC 断 hard=0(复刻 `divider_pack_smoke` 范式)。

- [ ] **Step 1: 写失败测试** —— `circuit_packs/archetypes/fanout.test.mjs` 顶部 import 区追加

```javascript
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';
```

文件末尾追加:

```javascript
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

test('fanout:冒烟 — 真实 geomQC/labelQC hard=0', () => {
	const part = connector('J1');
	const c = fanoutArchetype({ parts: [part], anchor, nets: { pinNets } });
	const model = { components: [worldComponent(part, c.place.J1)], wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	const labelHard = labelQC(model).filter(f => f.severity === 'hard');
	assert.deepEqual(labelHard, [], 'labelQC hard');
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `node --test circuit_packs/archetypes/fanout.test.mjs`
Expected: PASS（7 个用例,含冒烟)。
**若 geomQC 某项非 0 或 labelQC 有 hard,停下报告实际数值**(可能桩穿体或标签净空不足),不要改阈值绕过。

- [ ] **Step 3: 全量回归(实际输出行写进报告)**

Run: `node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs`
Expected: `fail 0`;记录末尾 `tests`/`pass`/`fail` 计数(应为 70 + fanout 7 + registry 1 = 78)。
Run: `npm test`
Expected: `Fast Template Harness | Score 100/100 | PASS`;记录该行。

- [ ] **Step 4: 提交**

```bash
git add circuit_packs/archetypes/fanout.test.mjs
git commit -m "test: prove fanout archetype passes geomQC/labelQC hard=0"
```
提交后 `git show --stat HEAD` 确认恰 1 文件。

---

## Self-Review

**1. Spec coverage:** 接口(spec §3)→ Task 1;参考几何水平扇出(spec §4)→ Task 1;注册 connector(spec §1/§7)→ Task 2;fail-closed 负例(spec §5)→ Task 1 负例;真实 geomQC/labelQC 冒烟(spec §6)→ Task 3;文件清单(spec §7)→ Task 1/2/3。✓

**2. Placeholder scan:** 无 TBD;每代码步含完整代码;合成 connector 脚 x=±30 超出 localBox x±15(桩不穿体)、纵向间距 40>净空、全格点。`labelStub` 显式 `escX` 避免默认 esc_gap 非格点。✓

**3. Type consistency:** `fanoutArchetype(spec)→{place,wires,flags,noConnects,region}` 跨任务一致;`connector`/`anchor`/`pinNets`/`cell` 夹具 Task 1 定义、Task 3 复用;`ARCHETYPES` 表项一致;`model.{components,wires,netflags}` 与 geomQC/labelQC 输入一致。✓

## Execution Handoff

见对话:转入 subagent-driven-development 执行。

# Plexus archetype 角色化原型库(第一刀)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `circuit_packs/archetypes/` 建立"角色→标准 cell"通用绘制层:统一接口 + 角色注册表 + 1 个参考原型(support 无源件竖直串),用真实 geomQC/labelQC 冒烟证明可过门(hard=0)。

**Architecture:** `supportArchetype(spec)` 是纯函数,完全用 `engine/cell_helpers.mjs` 原语把 N 个 2 端无源件竖直串接成 cell;`registry.mjs` 按角色分发(`getArchetype`/`renderArchetype`)。输出 `{place,wires,flags,noConnects,region}` 与现有 cell builder 同形,可被同一套 geomQC/labelQC 校验。冒烟复刻 `engine/divider_pack_smoke.mjs` 范式。

**Tech Stack:** Node.js ESM(`.mjs`)、`node:test` + `node:assert/strict`。复用 `engine/cell_helpers.mjs`、`engine/transform.mjs`、`engine/geom_qc.mjs`、`engine/label_qc.mjs`。无新依赖。

## Global Constraints

- 语言/风格:ESM `.mjs`,纯函数,确定性输出(依赖 parts 顺序与 anchor;禁 `Date.now`/`Math.random`)。
- 完全用 `engine/cell_helpers.mjs` 构建几何,**不手摆任何裸导线/网标**;继承其对斜线/浮空标签/超长桩的 fail-fast。
- 输出同形:`{ place:{des:{x,y,rot,mirror}}, wires:[{net,line}], flags:[…], noConnects:[], region:{minX,minY,maxX,maxY} }`。
- 关键数据形状(只读):无源件 `{ designator, pins:[{num,local:[x,y]}], localBox:{minX,minY,maxX,maxY} }`;`toWorld(local,[x,y],rot,mirror)`;`geomQC(model)→{overlaps,wireThruComp,offgrid,crossings,crossEx}`;`labelQC(model)→[{…,severity}]`;`model={components:[{designator,pins:[{num,x,y}],bbox}],wires,netflags}`。
- 测试:中文用例名,贴合 `engine/role_infer.test.mjs`/`divider_pack_smoke.mjs` 风格;并入现有套件零回归(`node --test engine/*.test.mjs` 仍全绿;新测全绿;`npm test` 100/100 不变)。
- Git:在功能分支 `feat/plexus-archetypes` 上执行(勿用默认 main 直接落任务提交)。逐任务提交**只 `git add` 本任务涉及文件**;绝不 `git add -A`/`.`(工作区有大量无关未提交改动);提交后 `git show --stat HEAD` 自验文件数。不 push、不开 PR(除非用户另行要求)。

---

### Task 1: supportArchetype 参考原型

**Files:**
- Create: `circuit_packs/archetypes/support.mjs`
- Test: `circuit_packs/archetypes/support.test.mjs`

**Interfaces:**
- Consumes: `toWorld` from `../../engine/transform.mjs`;`wire, labelStub, gndStub, powerStub, regionOf, q10, mergeParts, assertOrthogonalWires, assertLabelsAttached` from `../../engine/cell_helpers.mjs`。
- Produces: `supportArchetype(spec) -> { place, wires, flags, noConnects, region }`,其中 `spec = { parts:[{designator,pins:[{num,local}],localBox}], anchor:{x,y}, nets:{top?:{name,class},bottom?:{name,class},side?:{name,class}}, opts:{tapIndex?} }`。规则:每件 `rot 90` 在 `(anchor.x, anchor.y - i*60)` 竖直堆叠;相邻件 `pin1(下)→pin2(上)` 无网名正交线串接;`side` signal 在第 `tapIndex` 个链内结点出 `labelStub`;`top`/`bottom` 按 power/ground 出 `powerStub`/`gndStub`。

- [ ] **Step 1: 写失败测试** —— 创建 `circuit_packs/archetypes/support.test.mjs`

```javascript
// support 角色原型单测:无源件竖直串(纯函数,完全基于 cell_helpers)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportArchetype } from './support.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from '../../engine/cell_helpers.mjs';

function passive(designator) {
	return {
		designator,
		pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
		localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
	};
}
const anchor = { x: 1000, y: 1000 };
const nets = {
	top: { name: 'V5', class: 'power' },
	bottom: { name: 'GND', class: 'ground' },
	side: { name: 'VMID', class: 'signal' },
};
const cell = supportArchetype({ parts: [passive('R1'), passive('R2'), passive('R3')], anchor, nets });

test('support:N 件竖直等距、rot 90、x 对齐 anchor', () => {
	assert.equal(cell.place.R1.rot, 90);
	assert.equal(cell.place.R1.x, 1000);
	assert.equal(cell.place.R1.y, 1000);
	assert.equal(cell.place.R2.y, 940);
	assert.equal(cell.place.R3.y, 880);
});

test('support:导线全正交、标签全附着', () => {
	assert.doesNotThrow(() => assertOrthogonalWires(cell.wires));
	assert.doesNotThrow(() => assertLabelsAttached(cell.wires, cell.flags));
});

test('support:端点出桩按网类(power/gnd/sig)', () => {
	const kinds = cell.flags.map(f => f.kind).sort();
	assert.ok(kinds.includes('power'));   // 顶 V5
	assert.ok(kinds.includes('gnd'));     // 底 GND
	assert.ok(kinds.includes('sig'));     // 侧 VMID
});

test('support:region 覆盖所有件', () => {
	assert.ok(cell.region.minX < 1000 && cell.region.maxX > 1000);
	assert.ok(cell.region.minY < 880 && cell.region.maxY > 1000);
});

test('support:确定性(同输入两次深相等)', () => {
	const a = supportArchetype({ parts: [passive('R1'), passive('R2')], anchor, nets });
	const b = supportArchetype({ parts: [passive('R1'), passive('R2')], anchor, nets });
	assert.deepEqual(a, b);
});

test('support:负例(空 parts/非2端/侧信号<2件)抛错', () => {
	assert.throws(() => supportArchetype({ parts: [], anchor }));
	assert.throws(() => supportArchetype({
		parts: [{ designator: 'U1', pins: [{ num: '1', local: [0, 0] }, { num: '2', local: [1, 0] }, { num: '3', local: [2, 0] }] }],
		anchor,
	}));
	assert.throws(() => supportArchetype({ parts: [passive('R1')], anchor, nets: { side: { name: 'X', class: 'signal' } } }));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test circuit_packs/archetypes/support.test.mjs`
Expected: FAIL —— `Cannot find module './support.mjs'`。

- [ ] **Step 3: 写实现** —— 创建 `circuit_packs/archetypes/support.mjs`

```javascript
// 角色原型:support 无源件竖直串(泛化 dividerCell)。完全用 cell_helpers 构建几何。
import { toWorld } from '../../engine/transform.mjs';
import { wire, labelStub, gndStub, powerStub, regionOf, q10, mergeParts } from '../../engine/cell_helpers.mjs';

const PITCH = 60;   // 件中心纵向间距(GRID=10 的整数倍)

const pinOf = (part, num) => (part.pins || []).find(p => String(p.num) === String(num));

export function supportArchetype(spec = {}) {
	const { parts, anchor, nets = {}, opts = {} } = spec;
	if (!Array.isArray(parts) || parts.length === 0) {
		throw new Error('supportArchetype: spec.parts must be a non-empty array');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('supportArchetype: spec.anchor {x,y} required');
	}
	for (const p of parts) {
		if ((p.pins || []).length !== 2) {
			throw new Error(`supportArchetype: ${p.designator} is not a 2-terminal part`);
		}
	}
	const tapIndex = Number.isInteger(opts.tapIndex) ? opts.tapIndex : 0;
	if (nets.side && nets.side.class === 'signal' && parts.length < 2) {
		throw new Error('supportArchetype: side signal tap needs >= 2 parts (no internal junction)');
	}

	const place = {};
	const pin = {};   // designator -> { p1:[x,y], p2:[x,y] }
	parts.forEach((part, i) => {
		const pl = { x: anchor.x, y: anchor.y - i * PITCH, rot: 90, mirror: false };
		place[part.designator] = pl;
		const p1 = pinOf(part, '1') || part.pins[0];
		const p2 = pinOf(part, '2') || part.pins[1];
		pin[part.designator] = {
			p1: toWorld(p1.local, [pl.x, pl.y], pl.rot, pl.mirror),
			p2: toWorld(p2.local, [pl.x, pl.y], pl.rot, pl.mirror),
		};
	});

	const frags = [];
	for (let k = 0; k + 1 < parts.length; k++) {
		const a = pin[parts[k].designator].p1;        // 件 k 下端
		const b = pin[parts[k + 1].designator].p2;    // 件 k+1 上端
		if (k === tapIndex && nets.side && nets.side.class === 'signal') {
			const t = [anchor.x, q10((a[1] + b[1]) / 2)];
			frags.push({ wires: [wire('', [a, t]), wire('', [t, b])], flags: [] });
			frags.push(labelStub(nets.side.name, t, { side: 'right', escX: t[0] + 30 }));
		} else {
			frags.push({ wires: [wire('', [a, b])], flags: [] });
		}
	}

	const top = pin[parts[0].designator].p2;
	if (nets.top && nets.top.class === 'power') frags.push(powerStub(nets.top.name, top, { dir: 'up', len: 50 }));
	else if (nets.top && nets.top.class === 'ground') frags.push(gndStub(top, { dir: 'up', len: 30, net: nets.top.name }));

	const bot = pin[parts[parts.length - 1].designator].p1;
	if (nets.bottom && nets.bottom.class === 'ground') frags.push(gndStub(bot, { dir: 'down', len: 30, net: nets.bottom.name }));
	else if (nets.bottom && nets.bottom.class === 'power') frags.push(powerStub(nets.bottom.name, bot, { dir: 'down', len: 50 }));

	const merged = mergeParts(...frags);
	const pts = [];
	for (const d of Object.keys(pin)) pts.push(pin[d].p1, pin[d].p2);
	const region = regionOf(pts, 20);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test circuit_packs/archetypes/support.test.mjs`
Expected: PASS（6 个用例)。

- [ ] **Step 5: 提交**

```bash
git add circuit_packs/archetypes/support.mjs circuit_packs/archetypes/support.test.mjs
git commit -m "feat: add support archetype (vertical passive series) from cell helpers"
```
提交后 `git show --stat HEAD` 确认恰为这 2 文件。

---

### Task 2: 角色注册表 registry

**Files:**
- Create: `circuit_packs/archetypes/registry.mjs`
- Test: `circuit_packs/archetypes/registry.test.mjs`

**Interfaces:**
- Consumes: `supportArchetype` from `./support.mjs`(Task 1)。
- Produces: `getArchetype(role) -> fn`(未知 role 抛错);`renderArchetype(role, spec) -> cell`(分发到 `getArchetype(role)(spec)`)。

- [ ] **Step 1: 写失败测试** —— 创建 `circuit_packs/archetypes/registry.test.mjs`

```javascript
// 角色原型注册表单测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getArchetype, renderArchetype } from './registry.mjs';
import { supportArchetype } from './support.mjs';

const passive = d => ({
	designator: d,
	pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
	localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
});

test('registry:getArchetype(support) 返回 supportArchetype', () => {
	assert.equal(getArchetype('support'), supportArchetype);
});

test('registry:renderArchetype 分发到对应原型', () => {
	const cell = renderArchetype('support', { parts: [passive('R1'), passive('R2')], anchor: { x: 0, y: 0 }, nets: {} });
	assert.ok(cell.place.R1 && cell.place.R2);
	assert.ok(Array.isArray(cell.wires));
});

test('registry:未知 role 抛错', () => {
	assert.throws(() => getArchetype('nope'));
	assert.throws(() => renderArchetype('nope', {}));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test circuit_packs/archetypes/registry.test.mjs`
Expected: FAIL —— `Cannot find module './registry.mjs'`。

- [ ] **Step 3: 写实现** —— 创建 `circuit_packs/archetypes/registry.mjs`

```javascript
// 角色原型注册表:role -> 原型 fn;renderArchetype 薄分发。
import { supportArchetype } from './support.mjs';

const ARCHETYPES = { support: supportArchetype };

export function getArchetype(role) {
	const fn = ARCHETYPES[role];
	if (!fn) {
		throw new Error(`getArchetype: unknown role '${role}' (have: ${Object.keys(ARCHETYPES).join(', ')})`);
	}
	return fn;
}

export function renderArchetype(role, spec) {
	return getArchetype(role)(spec);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test circuit_packs/archetypes/registry.test.mjs`
Expected: PASS（3 个用例)。

- [ ] **Step 5: 提交**

```bash
git add circuit_packs/archetypes/registry.mjs circuit_packs/archetypes/registry.test.mjs
git commit -m "feat: add archetype role registry (getArchetype/renderArchetype)"
```
提交后 `git show --stat HEAD` 确认恰为这 2 文件。

---

### Task 3: geomQC/labelQC 冒烟 + 全量回归

**Files:**
- Modify: `circuit_packs/archetypes/support.test.mjs`(追加冒烟测试)

**Interfaces:**
- Consumes: `supportArchetype`(Task 1);`toWorld` from `../../engine/transform.mjs`;`geomQC` from `../../engine/geom_qc.mjs`;`labelQC` from `../../engine/label_qc.mjs`。
- Produces: 一个组装最小快照并跑真实 geomQC/labelQC 断言 hard=0 的测试(复刻 `engine/divider_pack_smoke.mjs` 的 `worldComponent` + `model` 范式)。

- [ ] **Step 1: 写失败测试** —— 在 `circuit_packs/archetypes/support.test.mjs` 顶部 import 区追加

```javascript
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';
```

并在文件末尾追加(`worldComponent` 等价 `divider_pack_smoke` 的核心组装一步):

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

test('support:冒烟 — 真实 geomQC/labelQC hard=0', () => {
	const parts = [passive('R1'), passive('R2'), passive('R3')];
	const c = supportArchetype({ parts, anchor, nets });
	const model = {
		components: parts.map(p => worldComponent(p, c.place[p.designator])),
		wires: c.wires,
		netflags: c.flags,
	};
	const g = geomQC(model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	const labelHard = labelQC(model).filter(f => f.severity === 'hard');
	assert.deepEqual(labelHard, [], 'labelQC hard');
});
```

- [ ] **Step 2: 跑测试确认通过(本任务为新增断言,实现已在 Task 1 就绪)**

Run: `node --test circuit_packs/archetypes/support.test.mjs`
Expected: PASS（7 个用例,含冒烟)。
若冒烟某项非 0,**先停下报告**实际 `geomQC` 返回值,不要改阈值绕过。

- [ ] **Step 3: 全量回归**

Run: `node --test engine/*.test.mjs circuit_packs/archetypes/*.test.mjs`
Expected: PASS,`fail 0`;把末尾 `tests`/`pass`/`fail` 计数写进报告。

Run: `npm test`
Expected: `Fast Template Harness | Score 100/100 | PASS`(无回归);把该行写进报告。

- [ ] **Step 4: 提交**

```bash
git add circuit_packs/archetypes/support.test.mjs
git commit -m "test: add geomQC/labelQC smoke proving support archetype passes gates hard=0"
```
提交后 `git show --stat HEAD` 确认恰为这 1 文件。

---

## Self-Review

**1. Spec coverage:**
- 接口契约(spec §4)→ Task 1 产出 `{place,wires,flags,noConnects,region}` + Task 2 `renderArchetype` 分发。✓
- 参考原型 support 竖直串(spec §5:rot90 堆叠 / 串接 / 端点按网类出桩 / tapIndex 侧标签)→ Task 1。✓
- 注册表 `getArchetype`/`renderArchetype` + 未知 role 快失败(spec §3/§6)→ Task 2。✓
- 错误处理(spec §6:空 parts / 未知 role / 非 2 端 / 侧信号<2件)→ Task 1 负例测 + Task 2 未知 role 测。✓
- 测试:单测 + geomQC/labelQC 冒烟(spec §7)→ Task 1(单测)+ Task 3(冒烟 + 全量回归)。✓
- 位置 `circuit_packs/archetypes/`(spec §2/§9)→ 全部文件。✓
- 文件清单(spec §9)→ 注:spec §9 列了 support.mjs/registry.mjs/support.test.mjs;本计划额外加 `registry.test.mjs`(更聚焦的注册表测试,优于塞进 support.test.mjs),属合理拆分。✓

**2. Placeholder scan:** 无 TBD/TODO;每个代码步含完整可跑代码;`labelStub` 显式传 `escX` 避免默认 esc_gap 非格点导致 offgrid(复刻 divider 已验证模式)。✓

**3. Type consistency:** `supportArchetype(spec)`/`getArchetype(role)`/`renderArchetype(role,spec)` 签名跨任务一致;`spec.nets.{top,bottom,side}.{name,class}`、`cell.{place,wires,flags,noConnects,region}`、`model.{components,wires,netflags}` 字段跨 Task 1-3 一致;`passive()`/`anchor`/`nets` 测试夹具在 support.test.mjs 中定义并被 Task 3 冒烟复用。✓

## Execution Handoff

见对话:计划保存后向用户提供执行方式选择。

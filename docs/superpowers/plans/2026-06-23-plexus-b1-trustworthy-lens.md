# Plexus B1 可信镜头 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 造一面规则文档锚定的可信镜头——`twinPredict` 忠实预测模型在 EDA 的真实几何(bbox/脚/标注文字按放置重算),几何裁判补全到 DR4/DR5(全可见对象含 attr 不重叠)+ DR11-16(同侧扇出对齐),并用真 EDA 标定钉死。

**Architecture:** 复用实测 `eda_transform`(脚位 CCW/镜像翻 X)扩出 bbox 变换;`eda_twin.twinPredict(model,snapshot)` 反解本地几何再按新放置正算,产出与 `readGeometry` 同形几何直接喂 `judgeTokens`;扩 `geom_qc`/`token_conformance` 按 DR 查重叠与对齐;`twin_calibrate` 对照孪生预测与真 EDA;`live_loop` 安全闭环。

**Tech Stack:** Node ESM、`node --test`、现有 `eda_transform`/`geom_qc`/`token_conformance`/`bridge_windows`/`deliverGenerated`/`runLiveJudge`。无新依赖。

## Global Constraints

- **标准 = 规则文档,不自创**:每条检查代码注释引 DR 编号(`docs/schematic-design-rules.md`)/ rulebook 行号(`docs/schematic_design_rulebook.md`)。严标取 DR(如 DR1 正交 100%);不放水。
- **能机械判的绝不靠想象**;变换数学沿用 `eda_transform` 实测公式,严禁猜测。
- **fail-closed**:桥/读几何/DRC/截图不可用、标定超 tol、孪生未钉死、缺本地几何 → 绝不默认可信/通过。
- **离线 `sheet_renderer` 不得用于任何质量判定**(降级为结构 sanity)。
- **零特定电路内容**:代码/token 全通用;具体板几何/截图只进 scratchpad,绝不入库。新文件跑零特定电路字面量扫描。
- ESM、tab 缩进、`node --test`、接现有 `npm test`。
- 模型/几何形态:`{components:[{designator,x,y,rotation,mirror,bbox:{minX,minY,maxX,maxY},pins:[{num,name,x,y,type,noConnected}],attrs:[{key,value,x,y,keyVisible,valueVisible,bbox}]}], wires:[{net,line:[x0,y0,...]}], netflags:[{kind,net,x,y,textX,textY,rot,alignMode,bbox}], texts, rectangles}`。

---

### Task 1: `eda_transform` 补 bbox 变换(`placeBBox` / `inverseBBox`)

**Files:**
- Modify: `engine/eda_transform.mjs`
- Test: `engine/eda_transform.test.mjs`

**Interfaces:**
- Consumes: 现有 `placePin(ldx,ldy,ox,oy,rot,mirror)`、`localOffset(gx,gy,ox,oy,rot,mirror)`。
- Produces: `placeBBox(localBBox, ox, oy, rotation, mirror) -> {minX,minY,maxX,maxY}`;`inverseBBox(globalBBox, ox, oy, rotation, mirror) -> {minX,minY,maxX,maxY}`(本地偏移系)。

- [ ] **Step 1: Write the failing test**

追加到 `engine/eda_transform.test.mjs`(若无则新建,顶部 `import { placeBBox, inverseBBox, placePin } from './eda_transform.mjs'; import { test } from 'node:test'; import assert from 'node:assert/strict';`):

```js
test('placeBBox:rot90 把 10x20 本地 bbox 变成 20x10(宽高互换)', () => {
	const b = placeBBox({ minX: 0, minY: 0, maxX: 10, maxY: 20 }, 100, 100, 90, false);
	assert.equal(b.maxX - b.minX, 20);
	assert.equal(b.maxY - b.minY, 10);
});

test('placeBBox:rot0 mirror=false = 平移本地 bbox', () => {
	const b = placeBBox({ minX: 0, minY: 0, maxX: 10, maxY: 20 }, 100, 100, 0, false);
	assert.deepEqual(b, { minX: 100, minY: 100, maxX: 110, maxY: 120 });
});

test('inverseBBox 是 placeBBox 的逆(8 态往返=恒等)', () => {
	const local = { minX: -4, minY: -2, maxX: 6, maxY: 8 };
	for (const rot of [0, 90, 180, 270]) for (const mir of [false, true]) {
		const g = placeBBox(local, 37, -11, rot, mir);
		const back = inverseBBox(g, 37, -11, rot, mir);
		assert.deepEqual(back, local, `rot${rot} mir${mir}`);
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/eda_transform.test.mjs`
Expected: FAIL（`placeBBox is not a function`）

- [ ] **Step 3: Write minimal implementation**

追加到 `engine/eda_transform.mjs` 末尾:

```js
// 本地 bbox(rot0/mirror-false、相对原点)→ 全局 AABB。正交旋转+镜像保矩形轴对齐,
// 故变换对角两角再取 min/max 即得 AABB(DR4/DR5 重叠按真实占位判的地基)。
export function placeBBox(localBBox, ox, oy, rotation = 0, mirror = false) {
	const a = placePin(localBBox.minX, localBBox.minY, ox, oy, rotation, mirror);
	const b = placePin(localBBox.maxX, localBBox.maxY, ox, oy, rotation, mirror);
	return { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
}

// 全局 AABB → 本地 bbox(placeBBox 的逆;用 localOffset 反解对角两角)。
export function inverseBBox(globalBBox, ox, oy, rotation = 0, mirror = false) {
	const a = localOffset(globalBBox.minX, globalBBox.minY, ox, oy, rotation, mirror);
	const b = localOffset(globalBBox.maxX, globalBBox.maxY, ox, oy, rotation, mirror);
	return { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/eda_transform.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/eda_transform.mjs engine/eda_transform.test.mjs
git commit -m "feat: eda_transform 补 placeBBox/inverseBBox(实测变换扩到 bbox,8态往返恒等)"
```

---

### Task 2: `eda_twin.twinPredict`(忠实预测 EDA 几何)

**Files:**
- Create: `engine/eda_twin.mjs`
- Test: `engine/eda_twin.test.mjs`

**Interfaces:**
- Consumes: `placePin`、`placeBBox`、`localOffset`、`inverseBBox`（Task 1）。
- Produces: `twinPredict(model, snapshot) -> {components:[{designator,x,y,rotation,mirror,bbox,pins,attrs}], wires, netflags, texts, rectangles}`（与 `readGeometry` 同形）。模型件不在快照 → throw（fail-closed）。

- [ ] **Step 1: Write the failing test**

```js
// engine/eda_twin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twinPredict } from './eda_twin.mjs';

// 快照件:在原点 rot0,bbox 10x20,1 个脚 + 1 个可见标注
const snap = {
	components: [{
		designator: 'X1', x: 0, y: 0, rotation: 0, mirror: false,
		bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
		pins: [{ num: '1', name: 'A', x: 10, y: 5, type: 'in', noConnected: false }],
		attrs: [{ key: 'Name', value: '10k', x: 2, y: 22, valueVisible: true, bbox: { minX: 2, minY: 22, maxX: 12, maxY: 36 } }],
	}],
};

test('twinPredict:旋转件 bbox 被重算(rot90 → 宽高互换),脚/标注随放置变换', () => {
	const model = { components: [{ designator: 'X1', x: 100, y: 100, rotation: 90, mirror: false }] };
	const g = twinPredict(model, snap);
	const c = g.components[0];
	assert.equal(c.bbox.maxX - c.bbox.minX, 20);   // 原 10 → 旋转后 20
	assert.equal(c.bbox.maxY - c.bbox.minY, 10);   // 原 20 → 旋转后 10
	assert.equal(c.pins[0].x, 95); assert.equal(c.pins[0].y, 110);   // (10,5) rot90 → (-5,10)+origin
	assert.ok(c.attrs[0].bbox, '标注 bbox 应预测出');
});

test('twinPredict:输出与 readGeometry 同形(顶层键齐全)', () => {
	const g = twinPredict({ components: [{ designator: 'X1', x: 0, y: 0, rotation: 0, mirror: false }] }, snap);
	for (const k of ['components', 'wires', 'netflags', 'texts', 'rectangles']) assert.ok(k in g, `缺 ${k}`);
});

test('twinPredict:模型件不在快照 → 抛(fail-closed,不瞎猜)', () => {
	assert.throws(() => twinPredict({ components: [{ designator: 'ZZ', x: 0, y: 0 }] }, snap), /不在快照/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/eda_twin.test.mjs`
Expected: FAIL（`Cannot find module './eda_twin.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/eda_twin.mjs
// 模型→「EDA 会怎么画」的忠实几何孪生(零特定电路)。从快照反解本地几何,按 model 新放置正算。
// 输出与 bridge_windows.readGeometry 同形 → 直接喂 token_conformance.judgeTokens。
import { placePin, placeBBox, localOffset, inverseBBox } from './eda_transform.mjs';

export function twinPredict(model, snapshot) {
	const byDes = new Map((snapshot.components || []).map(c => [c.designator, c]));
	const components = [];
	for (const c of model.components || []) {
		const s = byDes.get(c.designator);
		if (!s) throw new Error(`twinPredict: 模型件 ${c.designator} 不在快照,无本地几何真源(fail-closed)`);
		const sr = s.rotation || 0, sm = s.mirror || false;
		// 反解本地几何(快照捕获帧 → rot0/mirror-false 相对原点)
		const localPins = (s.pins || []).map(p => { const [lx, ly] = localOffset(p.x, p.y, s.x, s.y, sr, sm); return { num: p.num, name: p.name, type: p.type, noConnected: !!p.noConnected, ldx: lx, ldy: ly }; });
		const localBody = s.bbox ? inverseBBox(s.bbox, s.x, s.y, sr, sm) : null;
		const localAttrs = (s.attrs || []).map(a => { const [lx, ly] = localOffset(a.x, a.y, s.x, s.y, sr, sm); const lb = a.bbox ? inverseBBox(a.bbox, s.x, s.y, sr, sm) : null; return { key: a.key, value: a.value, keyVisible: a.keyVisible, valueVisible: a.valueVisible, ldx: lx, ldy: ly, lbbox: lb }; });
		// 按 model 新放置正算
		const rot = c.rotation || 0, mir = c.mirror || false;
		const pins = localPins.map(p => { const [gx, gy] = placePin(p.ldx, p.ldy, c.x, c.y, rot, mir); return { num: p.num, name: p.name, type: p.type, noConnected: p.noConnected, x: gx, y: gy }; });
		const bbox = localBody ? placeBBox(localBody, c.x, c.y, rot, mir) : null;
		const attrs = localAttrs.map(a => { const [gx, gy] = placePin(a.ldx, a.ldy, c.x, c.y, rot, mir); return { key: a.key, value: a.value, keyVisible: a.keyVisible, valueVisible: a.valueVisible, x: gx, y: gy, bbox: a.lbbox ? placeBBox(a.lbbox, c.x, c.y, rot, mir) : null }; });
		components.push({ designator: c.designator, x: c.x, y: c.y, rotation: rot, mirror: mir, bbox, pins, attrs });
	}
	return { components, wires: model.wires || [], netflags: model.netflags || [], texts: model.texts || [], rectangles: model.rectangles || [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/eda_twin.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/eda_twin.mjs engine/eda_twin.test.mjs
git commit -m "feat: eda_twin.twinPredict 忠实预测EDA几何(bbox/脚/标注按放置重算,缺快照件failclosed)"
```

---

### Task 3: `geom_qc` 重叠补全到 DR4/DR5(纳入标注/文字/flag)

**Files:**
- Modify: `engine/geom_qc.mjs`
- Test: `engine/geom_qc.test.mjs`

**Interfaces:**
- Consumes: 模型件含 `attrs:[{valueVisible|keyVisible, bbox}]`（Task 2 产出）。
- Produces: `geomQC(model).overlaps` 现额外包含 `attr:<des>.<key>` 标注 bbox 与其它可见对象(器件本体 DR5、其它标注/flag DR4)的重叠;新增 `textOnWire` 数组(标注 bbox 被异网线段穿过,rulebook 行 166)。

- [ ] **Step 1: Write the failing test**

追加到 `engine/geom_qc.test.mjs`:

```js
test('DR4:两器件的可见标注 bbox 重叠 → overlaps 报 attr 对', () => {
	const m = { components: [
		{ designator: 'R1', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: true, bbox: { minX: 0, minY: 8, maxX: 20, maxY: 14 } }] },
		{ designator: 'R2', bbox: { minX: 40, minY: 0, maxX: 50, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: true, bbox: { minX: 12, minY: 8, maxX: 32, maxY: 14 } }] },
	] };
	const r = geomQC(m);
	assert.ok(r.overlaps.some(s => s.includes('attr:R1.Name') && s.includes('attr:R2.Name')), JSON.stringify(r.overlaps));
});

test('DR5:标注 bbox 压到别的器件本体 → overlaps 报', () => {
	const m = { components: [
		{ designator: 'U1', bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 }, pins: [], attrs: [] },
		{ designator: 'R9', bbox: { minX: 100, minY: 100, maxX: 110, maxY: 106 }, pins: [], attrs: [{ key: 'Designator', valueVisible: true, bbox: { minX: 5, minY: 5, maxX: 25, maxY: 12 } }] },
	] };
	const r = geomQC(m);
	assert.ok(r.overlaps.some(s => s.includes('attr:R9.Designator') && s.includes('U1')), JSON.stringify(r.overlaps));
});

test('不可见标注不计入重叠', () => {
	const m = { components: [
		{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: false, bbox: { minX: 0, minY: 8, maxX: 20, maxY: 14 } }] },
		{ designator: 'B', bbox: { minX: 40, minY: 0, maxX: 50, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: false, bbox: { minX: 12, minY: 8, maxX: 32, maxY: 14 } }] },
	] };
	assert.equal(geomQC(m).overlaps.filter(s => s.includes('attr:')).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/geom_qc.test.mjs`
Expected: FAIL（overlaps 不含 attr 标签）

- [ ] **Step 3: Write minimal implementation**

在 `engine/geom_qc.mjs` 构造 `rects`(器件 + flag bbox)处,追加可见标注 bbox(DR4/DR5:`docs/schematic-design-rules.md`)。在现有 `for (const c of comps) rects.push({ tag: c.designator, ...c.bbox });` 之后加:

```js
	// DR4/DR5:可见 attribute/text 也是不可重叠的可见对象(rulebook "Geometry Audit" 节要求审 attribute bbox)。
	for (const c of model.components || []) {
		for (const a of (c.attrs || [])) {
			if (!a.bbox || !(a.valueVisible || a.keyVisible)) continue;
			rects.push({ tag: `attr:${c.designator}.${a.key || '?'}`, minX: a.bbox.minX, minY: a.bbox.minY, maxX: a.bbox.maxX, maxY: a.bbox.maxY });
		}
	}
```

并在函数返回对象补 `textOnWire`(rulebook 行 166:文字压异网线=hard)。在已有 wire 段循环区域后追加:

```js
	// rulebook 行 166:可见标注 bbox 被【异网】线段穿过 = hard。
	const textOnWire = [];
	for (const c of model.components || []) for (const a of (c.attrs || [])) {
		if (!a.bbox || !(a.valueVisible || a.keyVisible)) continue;
		for (const s of segs) { if (segInRect(s, a.bbox)) { textOnWire.push(`attr:${c.designator}.${a.key || '?'} x wire[${s.net || ''}]`); break; } }
	}
```

把 `textOnWire` 加入 `return { overlaps, ... }`(若 `segs`/`segInRect` 名称不同,沿用本文件既有的 wire 段集合与"段在矩形内"判定函数;在 Step 1 跑红后按文件实际命名对齐)。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/geom_qc.test.mjs`
Expected: PASS（含既有用例零回归）

- [ ] **Step 5: Commit**

```bash
git add engine/geom_qc.mjs engine/geom_qc.test.mjs
git commit -m "feat: geom_qc 重叠补全到 DR4/DR5(纳入可见标注/文字 bbox)+textOnWire(rulebook166)"
```

---

### Task 4: `T-LABEL-ALIGN`(DR11/12/13/16)+ `T-NOOVERLAP` 接 DR4/5 + 接入 `judgeTokens`

**Files:**
- Modify: `engine/design_tokens.mjs`
- Modify: `engine/token_conformance.mjs`
- Test: `engine/token_conformance.test.mjs`
- Test: `engine/design_tokens.test.mjs`

**Interfaces:**
- Consumes: `tokenById`、`geomQC`(Task 3,overlaps 已含 attr)。
- Produces: `checkLabelAlign(model) -> {token:'T-LABEL-ALIGN',conform,deviations,detail}`;`judgeTokens` 的 tier2 增列 `checkLabelAlign`;`design_tokens` 增 `T-LABEL-ALIGN`。

- [ ] **Step 1: Write the failing test**

`engine/design_tokens.test.mjs` 追加:

```js
test('T-LABEL-ALIGN 存在且严标(同侧共列、行距)', () => {
	const t = tokenById('T-LABEL-ALIGN');
	assert.ok(t && t.evidence === 'geom' && t.tier === 2, '应为 geom/tier2');
	assert.ok(t.value.xTol >= 0 && t.value.minPitch > 0);
});
```

`engine/token_conformance.test.mjs` 追加:

```js
import { checkLabelAlign } from './token_conformance.mjs';

test('T-LABEL-ALIGN:同侧扇出共列 x → 符合', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 100, textY: 20, alignMode: 6 },
		{ kind: 'sig', net: 'C', textX: 100, textY: 40, alignMode: 6 },
	] };
	assert.equal(checkLabelAlign(m).conform, true);
});

test('T-LABEL-ALIGN:同侧 x 散开(不成列)→ 不符合', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 160, textY: 20, alignMode: 6 },
	] };
	const r = checkLabelAlign(m);
	assert.equal(r.conform, false);
	assert.ok(r.deviations.some(d => d.kind === 'column-x-spread'));
});

test('T-LABEL-ALIGN:行距过密(糊成一团)→ 不符合(DR16)', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 100, textY: 3, alignMode: 6 },
	] };
	assert.ok(checkLabelAlign(m).deviations.some(d => d.kind === 'row-pitch-merged'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/design_tokens.test.mjs engine/token_conformance.test.mjs`
Expected: FAIL（`T-LABEL-ALIGN` 不存在 / `checkLabelAlign is not a function`）

- [ ] **Step 3: Write minimal implementation**

`engine/design_tokens.mjs` 的 `TOKENS` 数组追加:

```js
	{ id: 'T-LABEL-ALIGN', category: '标签', desc: '同侧扇出标签:左alignMode6/右8、同侧共列x、行距可读不糊', value: { xTol: 5, minPitch: 10 }, source: 'DR11/12/13/16', evidence: 'geom', tier: 2 },
```

并把 `T-NOOVERLAP` 的 `desc` 改为(显式覆盖 attr):`'可见对象(含标号/阻值/flag/NC)互不重叠、不压本体'`(DR4/DR5)。

`engine/token_conformance.mjs` 追加 `checkLabelAlign`(side 由 alignMode 定:6=右,8=左;约定见 `cluster_generate.mjs:261-263`):

```js
// T-LABEL-ALIGN:同侧扇出标签 alignMode 合法 + 同侧共列 x(容差) + 行距不糊(DR11/12/13/16)。
// side: alignMode 6→右, 8→左;其它(2/上下)本检查跳过(B1 先管左右扇出列)。
export function checkLabelAlign(model) {
	const v = tokenById('T-LABEL-ALIGN').value;
	const labs = (model.netflags || []).filter(f => f.kind === 'sig');
	const dev = [];
	const sideOf = f => f.alignMode === 8 ? 'left' : f.alignMode === 6 ? 'right' : null;
	for (const f of labs) { if (sideOf(f) === null) dev.push({ kind: 'bad-alignmode', at: [f.textX ?? f.x, f.textY ?? f.y], alignMode: f.alignMode ?? null }); }
	for (const side of ['left', 'right']) {
		const g = labs.filter(f => sideOf(f) === side);
		if (g.length < 2) continue;
		const xs = g.map(f => f.textX ?? f.x);
		if (Math.max(...xs) - Math.min(...xs) > v.xTol) dev.push({ kind: 'column-x-spread', side, spread: +(Math.max(...xs) - Math.min(...xs)).toFixed(1) });
		const ys = g.map(f => f.textY ?? f.y).sort((a, b) => a - b);
		for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] < v.minPitch) { dev.push({ kind: 'row-pitch-merged', side, pitch: +(ys[i] - ys[i - 1]).toFixed(1) }); break; }
	}
	return { token: 'T-LABEL-ALIGN', conform: dev.length === 0, deviations: dev, detail: { labels: labs.length } };
}
```

在 `judgeTokens` 的 tier2 列表里加入 `checkLabelAlign(model)`(放在 `checkAnnotFull` 之后):

```js
		checkDensity(model), checkAnnotPlace(model), checkAnnotFull(model), checkLabelAlign(model),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/design_tokens.test.mjs engine/token_conformance.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/design_tokens.mjs engine/token_conformance.mjs engine/token_conformance.test.mjs engine/design_tokens.test.mjs
git commit -m "feat: T-LABEL-ALIGN(DR11-16同侧扇出对齐)+T-NOOVERLAP接DR4/5,接入judgeTokens"
```

---

### Task 5: `readGeometry` 捕获标注/flag bbox + `estimateTextBBox` 兜底

**Files:**
- Modify: `engine/eda_transform.mjs`（加 `estimateTextBBox`）
- Modify: `engine/bridge_windows.mjs`（`SNAPSHOT_CODE` 抓 attr/flag bbox,EDA 给不了则兜底估算）
- Test: `engine/eda_transform.test.mjs`

**Interfaces:**
- Produces: `estimateTextBBox(text, x, y, alignMode, fontSize=14) -> {minX,minY,maxX,maxY}`（沿用 `cluster_generate.mjs:152-156` 的字串长×字宽公式,左/右 alignMode 决定向哪边展开）。`readGeometry` 产出的 `attrs[]` 增 `bbox` 字段。

- [ ] **Step 1: Write the failing test**

`engine/eda_transform.test.mjs` 追加:

```js
import { estimateTextBBox } from './eda_transform.mjs';

test('estimateTextBBox:alignMode6(右展开)bbox 从锚点向右', () => {
	const b = estimateTextBBox('10k', 100, 50, 6, 14);
	assert.equal(b.minX, 100);
	assert.ok(b.maxX > 100 && b.maxY - b.minY === 14);
});

test('estimateTextBBox:alignMode8(左展开)bbox 向左', () => {
	const b = estimateTextBBox('VCC', 100, 50, 8, 14);
	assert.equal(b.maxX, 100);
	assert.ok(b.minX < 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/eda_transform.test.mjs`
Expected: FAIL（`estimateTextBBox is not a function`）

- [ ] **Step 3: Write minimal implementation**

`engine/eda_transform.mjs` 追加(公式对齐 `cluster_generate.mjs:152-156`,字宽≈字号×0.6):

```js
// 估算可见文字 bbox(EDA 不给 attr bbox 时的兜底;标定钉死)。alignMode 6/7→右展开,8/9→左展开。
export function estimateTextBBox(text, x, y, alignMode = 6, fontSize = 14) {
	const len = Math.max(1, String(text || '').length) * fontSize * 0.6;
	const h = fontSize;
	if (alignMode === 8 || alignMode === 9) return { minX: x - len, minY: y, maxX: x, maxY: y + h };
	return { minX: x, minY: y, maxX: x + len, maxY: y + h };
}
```

在 `engine/bridge_windows.mjs` 的 `SNAPSHOT_CODE` 里,组件 attrs 映射处补抓每条 attr 的 bbox(优先 EDA `getPrimitivesBBox`,失败留 `null` 由消费侧兜底);并给 `netflags` 补 bbox。把 attrs 映射改为(在 `attrs: attrs.map(...)` 内补 `bbox`):

```js
      attrs: await Promise.all(attrs.map(async a=>{ let bb=null; try{ if(a.primitiveId){ const r=await eda.sch_Primitive.getPrimitivesBBox([a.primitiveId]); if(r) bb={minX:round(r.minX??r.x),minY:round(r.minY??r.y),maxX:round(r.maxX??(r.x+r.width)),maxY:round(r.maxY??(r.y+r.height))}; } }catch(e){} return {key:a.key||'', value:a.value||'', x:a.x, y:a.y, keyVisible:a.keyVisible??null, valueVisible:a.valueVisible??null, bbox:bb}; })),
```

> 说明:`a.primitiveId` 若 EDA 不暴露,则 `bb` 留 `null`,消费侧(twin/geom_qc)对 `null` bbox 跳过或用 `estimateTextBBox` 兜底;真实 attr bbox 的可得性由 Task 7 标定测定,不在此假设。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/eda_transform.test.mjs`
Expected: PASS（`estimateTextBBox` 单测;`SNAPSHOT_CODE` 为 EDA 端代码,由 Task 7 live 标定验证,不在 node --test）

- [ ] **Step 5: Commit**

```bash
git add engine/eda_transform.mjs engine/bridge_windows.mjs engine/eda_transform.test.mjs
git commit -m "feat: readGeometry 抓 attr/flag bbox + estimateTextBBox 兜底(标定钉死可得性)"
```

---

### Task 6: `twin_renderer` 忠实预览(取代 sheet_renderer 当质量预览)

**Files:**
- Create: `engine/twin_renderer.mjs`
- Test: `engine/twin_renderer.test.mjs`

**Interfaces:**
- Consumes: twin 几何(Task 2 产出)。
- Produces: `renderTwin(twinGeom, outPng, opts={width:1980}) -> { outPng }`,把真 bbox 画矩形、脚画点、可见 attr 画文字框、wires 画折线。

- [ ] **Step 1: Write the failing test**

```js
// engine/twin_renderer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTwin } from './twin_renderer.mjs';
import { existsSync, statSync, rmSync } from 'node:fs';

test('renderTwin:产出 PNG 文件(冒烟)', () => {
	const out = '/tmp/twin_smoke.png';
	const g = { components: [{ designator: 'X1', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 }, pins: [{ x: 10, y: 5 }], attrs: [{ key: 'Name', value: '1k', valueVisible: true, bbox: { minX: 0, minY: 22, maxX: 12, maxY: 36 } }] }], wires: [{ net: 'N', line: [10, 5, 30, 5] }], netflags: [], texts: [], rectangles: [] };
	renderTwin(g, out, { width: 600 });
	assert.ok(existsSync(out) && statSync(out).size > 0);
	rmSync(out, { force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/twin_renderer.test.mjs`
Expected: FAIL（`Cannot find module './twin_renderer.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/twin_renderer.mjs
// 忠实渲染 twin 几何(真 bbox+脚+可见标注框+线)。取代 sheet_renderer 当质量预览(符号美术不画,几何占位忠实)。
// 复用 sheet_renderer 的 SVG→PNG 落盘原语(transformFor + 写文件)。零特定电路。
import { transformFor } from './sheet_renderer.mjs';
import { writeFileSync } from 'node:fs';

export function renderTwin(twinGeom, outPng, opts = {}) {
	const width = opts.width ?? 1980, height = opts.height ?? 1220, margin = 40;
	const boxes = [];
	for (const c of twinGeom.components || []) if (c.bbox) boxes.push(c.bbox);
	for (const c of twinGeom.components || []) for (const a of (c.attrs || [])) if (a.bbox && (a.valueVisible || a.keyVisible)) boxes.push(a.bbox);
	const sheet = boxes.length ? { minX: Math.min(...boxes.map(b => b.minX)), minY: Math.min(...boxes.map(b => b.minY)), maxX: Math.max(...boxes.map(b => b.maxX)), maxY: Math.max(...boxes.map(b => b.maxY)) } : { minX: 0, minY: 0, maxX: 100, maxY: 100 };
	const t = transformFor(sheet, width, height, margin);
	const X = x => (x - sheet.minX) * t.scale + t.ox, Y = y => height - ((y - sheet.minY) * t.scale + t.oy);
	const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>`];
	for (const c of twinGeom.components || []) if (c.bbox) svg.push(`<rect x="${X(c.bbox.minX).toFixed(1)}" y="${Y(c.bbox.maxY).toFixed(1)}" width="${((c.bbox.maxX - c.bbox.minX) * t.scale).toFixed(1)}" height="${((c.bbox.maxY - c.bbox.minY) * t.scale).toFixed(1)}" fill="none" stroke="#c33" stroke-width="0.8"/>`);
	for (const c of twinGeom.components || []) for (const p of (c.pins || [])) svg.push(`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="1.5" fill="#06c"/>`);
	for (const c of twinGeom.components || []) for (const a of (c.attrs || [])) if (a.bbox && (a.valueVisible || a.keyVisible)) svg.push(`<rect x="${X(a.bbox.minX).toFixed(1)}" y="${Y(a.bbox.maxY).toFixed(1)}" width="${((a.bbox.maxX - a.bbox.minX) * t.scale).toFixed(1)}" height="${((a.bbox.maxY - a.bbox.minY) * t.scale).toFixed(1)}" fill="none" stroke="#999" stroke-dasharray="2"/>`);
	for (const w of twinGeom.wires || []) { const l = w.line || []; let d = ''; for (let i = 0; i + 1 < l.length; i += 2) d += `${i ? 'L' : 'M'}${X(l[i]).toFixed(1)} ${Y(l[i + 1]).toFixed(1)} `; if (d) svg.push(`<path d="${d}" fill="none" stroke="#093" stroke-width="0.6"/>`); }
	svg.push('</svg>');
	writeFileSync(outPng, svgToPng(svg.join(''), width, height));
	return { outPng };
}

// 若 sheet_renderer 已导出 svg→png 落盘函数则复用之;否则用其内部同一依赖(resvg/sharp)。Step1 跑红后对齐 sheet_renderer 实际用的转换器。
import { svgToPng } from './sheet_renderer.mjs';
```

> 说明:`transformFor`/`svgToPng` 若 `sheet_renderer` 未导出,Step1 红后改为复用其内部所用 SVG→PNG 库(本仓 `sheet_renderer` 已有该能力),保持本文件薄。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/twin_renderer.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/twin_renderer.mjs engine/twin_renderer.test.mjs
git commit -m "feat: twin_renderer 忠实预览(真bbox+脚+标注框+线),取代sheet_renderer当质量预览"
```

---

### Task 7: `twin_calibrate` 对照逻辑(钉死孪生)

**Files:**
- Create: `engine/twin_calibrate.mjs`
- Test: `engine/twin_calibrate.test.mjs`

**Interfaces:**
- Consumes: `geomQC`(或 `judgeTokens`)。
- Produces: `compareGeom(predicted, actual, opts={tol:2}) -> {maxPinErr,maxBBoxErr,maxAttrErr,tokenDiff,conform}`(逐件配对;`tokenDiff` 为每条 tier2 偏离数差);误差超 tol 或 tokenDiff 非零 → `conform:false`。

- [ ] **Step 1: Write the failing test**

```js
// engine/twin_calibrate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareGeom } from './twin_calibrate.mjs';

const mk = (dx = 0) => ({ components: [{ designator: 'X1', bbox: { minX: dx, minY: 0, maxX: 10 + dx, maxY: 20 }, pins: [{ num: '1', x: 10 + dx, y: 5 }], attrs: [] }], wires: [], netflags: [], texts: [], rectangles: [] });

test('compareGeom:预测=真实 → conform,误差 0', () => {
	const r = compareGeom(mk(0), mk(0), { tol: 2 });
	assert.equal(r.conform, true);
	assert.equal(r.maxPinErr, 0);
	assert.equal(r.maxBBoxErr, 0);
});

test('compareGeom:偏移超 tol → 不符合', () => {
	const r = compareGeom(mk(0), mk(10), { tol: 2 });
	assert.equal(r.conform, false);
	assert.ok(r.maxPinErr >= 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/twin_calibrate.test.mjs`
Expected: FAIL（`Cannot find module './twin_calibrate.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/twin_calibrate.mjs
// 钉死孪生:对照 twinPredict 预测几何 与 真 EDA readGeometry。纯对照逻辑(live 投递/读由 live_loop+控制者跑)。
import { geomQC } from './geom_qc.mjs';

function maxCornerErr(a, b) {
	if (!a || !b) return Infinity;
	return Math.max(Math.abs(a.minX - b.minX), Math.abs(a.minY - b.minY), Math.abs(a.maxX - b.maxX), Math.abs(a.maxY - b.maxY));
}

export function compareGeom(predicted, actual, opts = {}) {
	const tol = opts.tol ?? 2;
	const aByDes = new Map((actual.components || []).map(c => [c.designator, c]));
	let maxPinErr = 0, maxBBoxErr = 0, maxAttrErr = 0;
	for (const p of predicted.components || []) {
		const a = aByDes.get(p.designator); if (!a) { maxBBoxErr = Infinity; continue; }
		maxBBoxErr = Math.max(maxBBoxErr, maxCornerErr(p.bbox, a.bbox));
		const aPin = new Map((a.pins || []).map(q => [q.num, q]));
		for (const q of (p.pins || [])) { const r = aPin.get(q.num); if (r) maxPinErr = Math.max(maxPinErr, Math.hypot(q.x - r.x, q.y - r.y)); }
		const aAttr = new Map((a.attrs || []).map(x => [x.key, x]));
		for (const x of (p.attrs || [])) { const r = aAttr.get(x.key); if (r && x.bbox && r.bbox) maxAttrErr = Math.max(maxAttrErr, maxCornerErr(x.bbox, r.bbox)); }
	}
	// tier2 偏离数差(用 geomQC 的几个计数代表;judge 级别由调用方按需扩)
	const gp = geomQC(predicted), ga = geomQC(actual);
	const tokenDiff = { overlaps: Math.abs((gp.overlaps || []).length - (ga.overlaps || []).length), crossings: Math.abs((gp.crossings || 0) - (ga.crossings || 0)) };
	const conform = maxPinErr <= tol && maxBBoxErr <= tol && tokenDiff.overlaps === 0 && tokenDiff.crossings === 0;
	return { maxPinErr: +maxPinErr.toFixed(2), maxBBoxErr: maxBBoxErr === Infinity ? Infinity : +maxBBoxErr.toFixed(2), maxAttrErr: +maxAttrErr.toFixed(2), tokenDiff, conform };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/twin_calibrate.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/twin_calibrate.mjs engine/twin_calibrate.test.mjs
git commit -m "feat: twin_calibrate.compareGeom 对照孪生预测与真EDA(maxErr+tier2偏离数差,超tol failclosed)"
```

---

### Task 8: `live_loop` 安全闭环(preflight/备份/校验式还原)

**Files:**
- Create: `engine/live_loop.mjs`
- Test: `engine/live_loop.test.mjs`

**Interfaces:**
- Consumes: 注入式依赖 `{ readSnapshot, deliver, restore }`（便于单测;真实现包 `bridge_windows`/`deliverGenerated`）。
- Produces: `preflightGuard(opts)`（无 `confirmOverwrite` 抛）;`runLoop(model, deps, opts) -> { backupPath, observed }`（投递前必先 `readSnapshot` 备份)。

- [ ] **Step 1: Write the failing test**

```js
// engine/live_loop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightGuard, runLoop } from './live_loop.mjs';

test('preflightGuard:无 confirmOverwrite → 抛(防误投毁板)', () => {
	assert.throws(() => preflightGuard({}), /confirmOverwrite/);
	assert.doesNotThrow(() => preflightGuard({ confirmOverwrite: true }));
});

test('runLoop:deliver 之前必先写备份', async () => {
	const calls = [];
	const deps = {
		readSnapshot: async () => { calls.push('backup'); return { components: [] }; },
		deliver: async () => { calls.push('deliver'); },
		observe: async () => { calls.push('observe'); return { conform: false }; },
		writeBackup: (snap) => { calls.push('writeBackup'); return '/tmp/backup.json'; },
	};
	const r = await runLoop({ components: [] }, deps, { confirmOverwrite: true });
	assert.equal(calls.indexOf('writeBackup') < calls.indexOf('deliver'), true, '备份必在投递前');
	assert.ok(r.backupPath);
});

test('runLoop:无 confirmOverwrite 直接拒(不投递)', async () => {
	const deps = { readSnapshot: async () => ({}), deliver: async () => { throw new Error('不该投'); }, observe: async () => ({}), writeBackup: () => '/x' };
	await assert.rejects(() => runLoop({}, deps, {}), /confirmOverwrite/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/live_loop.test.mjs`
Expected: FAIL（`Cannot find module './live_loop.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/live_loop.mjs
// 薄真闭环:preflight 守门→备份→deliver→观测(judge)→可还原。安全第一(记忆 never-deliver-demo-to-user-board)。
// deps 注入(便于测/换实现):{ readSnapshot, deliver, observe, writeBackup, restore }。
export function preflightGuard(opts = {}) {
	if (!opts.confirmOverwrite) throw new Error('live_loop: 拒绝投递——需 confirmOverwrite(防误投毁板)');
}

export async function runLoop(model, deps, opts = {}) {
	preflightGuard(opts);
	const snap = await deps.readSnapshot();               // 投递前完整快照
	const backupPath = deps.writeBackup(snap);            // 必在 deliver 之前
	await deps.deliver(model);
	const observed = await deps.observe();                // runLiveJudge:真几何+DRC+截图
	if (opts.restore && deps.restore) {
		await deps.restore(snap);
		const after = await deps.readSnapshot();
		const ok = (after.components || []).length === (snap.components || []).length;
		if (!ok) throw new Error(`live_loop: 还原校验不过!板可能被改,备份在 ${backupPath}`);
	}
	return { backupPath, observed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/live_loop.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/live_loop.mjs engine/live_loop.test.mjs
git commit -m "feat: live_loop 安全闭环(preflight拒投+备份必先于投递+校验式还原)"
```

---

### Task 9: CLI 接线(`twin`/`calibrate`/`loop`)+ 全套零回归 + 文档

**Files:**
- Modify: `bin/plexus.mjs`
- Modify: `AGENTS.md`
- Test: 全套 `npm test`

**Interfaces:**
- Consumes: 全部前序。

- [ ] **Step 1: 全套测试零回归**

Run: `npm test`
Expected: 全绿(原有 266 + 新增),0 fail。

- [ ] **Step 2: 接 CLI**

在 `bin/plexus.mjs` 加三条命令(放在 `judge` 分支附近):

```js
	if (cmd === 'twin') {   // 离线忠实预览 + 离线 judgeTokens(tier2)
		const snap = loadSnap(args[0]);
		const out = args.find(a => /\.png$/.test(a)) || 'twin.png';
		const { generateLayout } = await import('../engine/cluster_generate.mjs');
		const { twinPredict } = await import('../engine/eda_twin.mjs');
		const { renderTwin } = await import('../engine/twin_renderer.mjs');
		const { judgeTokens } = await import('../engine/token_conformance.mjs');
		const r = await generateLayout(snap, {});
		const g = twinPredict(r.model, snap);
		renderTwin(g, out, { width: 1980 });
		const rep = judgeTokens(g, {});
		console.log('孪生忠实预览 ->', out, '(注:这是 EDA 实貌预测,非 sheet_renderer 美化图)');
		for (const t of rep.tier2) console.log('  ', t.token, ':', t.conform ? '符合' : '✗偏离', JSON.stringify(t.detail));
		console.log('tier1 DRC: 需 live(离线不可预测)');
		return;
	}
	if (cmd === 'calibrate') {   // 钉死孪生:需 live;由控制者执行
		console.log('calibrate --live:在 live_loop 上跑 deliver→read→compareGeom(需桥+confirmOverwrite)。见 spec B1 §6。');
		return;
	}
```

- [ ] **Step 3: 确认 sheet_renderer 不再被质量判定引用**

Run: `grep -rn "sheet_renderer\|renderSheetOutput" engine/ bin/ | grep -v "twin_renderer\|\.test\."`
Expected: 仅 `layout` 命令(结构预览)与 `twin_renderer` 复用其原语;无任何"质量判定/达标"路径依赖它。若有,改走 `twinPredict`+`judgeTokens`。

- [ ] **Step 4: 更新 AGENTS.md**

在架构清单补一行:

```markdown
- `engine/eda_twin.mjs` / `engine/twin_renderer.mjs` / `engine/twin_calibrate.mjs` / `engine/live_loop.mjs` —
  可信镜头(Spec B1):twinPredict 按 eda_transform 忠实预测 EDA 几何(bbox/脚/标注按放置重算),
  twin_renderer 取代 sheet_renderer 当质量预览,twin_calibrate 用真 EDA 钉死,live_loop 安全闭环。
  几何裁判已补全到 DR4/DR5(可见标注不重叠)+ DR11-16(同侧扇出对齐)。
```

- [ ] **Step 5: Commit**

```bash
git add bin/plexus.mjs AGENTS.md
git commit -m "feat: CLI twin/calibrate 接线 + sheet_renderer 退出质量判定 + AGENTS.md(Spec B1 可信镜头)"
```

---

## Self-Review

**1. Spec coverage(对 spec §1-§11):**
- §2 目标1 twinPredict → Task 2 ✓;§2 目标2 DR4/5+DR11-16 → Task 3/4 ✓;§2 目标3 twin_renderer → Task 6 ✓;§2 目标4 标定 → Task 7 ✓(对照逻辑;live 由控制者);§2 目标5 live_loop → Task 8 ✓。
- §4 模块表:eda_transform(T1/T5)、eda_twin(T2)、geom_qc(T3)、token_conformance/design_tokens(T4)、bridge_windows(T5)、twin_renderer(T6)、twin_calibrate(T7)、live_loop(T8)、bin/plexus+AGENTS(T9)——全覆盖 ✓。
- §5 数据流 → Task 2 实现 ✓;§6 标定两级 → Task 7 对照逻辑 + Level1/2 由控制者在 live_loop 上跑(spec §6,非 node --test)✓;§7 live_loop → Task 8 ✓;§8 fail-closed → Task 2(缺件抛)/7(超tol)/8(拒投/还原校验)✓。
- §10 验收1-6 → Task 2/3-4/7/8/9/全套 ✓。

**2. Placeholder scan:** 无 TBD/TODO。两处"Step1 红后对齐文件实际命名"(geom_qc 的 segs/segInRect;sheet_renderer 的 transformFor/svgToPng)是【明确的集成对齐指令 + 验证命令】,非占位——指明了要对齐的具体符号与回退做法。

**3. Type consistency:** `{minX,minY,maxX,maxY}` bbox 形态贯穿 T1-T7;`twinPredict→{components,wires,netflags,texts,rectangles}` 与 readGeometry 同形,T6/T7 消费一致;`checkLabelAlign→{token,conform,deviations,detail}` 与 Spec A 其它 checkXxx 一致并接 judgeTokens;sig 标签字段 `{kind:'sig',textX,textY,alignMode}` 与 `cluster_generate.mjs:261-263` 一致;`compareGeom` 的 `{maxPinErr,maxBBoxErr,tokenDiff,conform}` T7 内自洽。

**已知集成点(执行时按真实命名对齐,已在步骤内标注):** geom_qc 现有 wire 段集合/段在矩形内函数名;sheet_renderer 的 SVG→PNG 落盘原语;EDA `attribute.primitiveId`/`getPrimitivesBBox` 对 attr 的可得性(Task 7 标定测定,不可得则 estimateTextBBox 兜底)。Level1/Level2 真 EDA 标定与 B2 在可信镜头之上,由控制者执行,不进 `node --test`。

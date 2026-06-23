# 设计 token 单一真源 + 确定性符合裁判 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把裁判从"我想象的软尺打分"扳成"对文档严标【设计 token】的确定性符合检查",三层 deviation 报告、无合成百分比;在 vibe-buddy 上诚实判 3 层全挂、在 RK3576 上判别正确。

**Architecture:** 新增 `engine/design_tokens.mjs`(token 单一真源,严标取 DR1-18、RK3576 实测仅填 DR 未量化处);新增 `engine/token_conformance.mjs`(逐 token 确定性检查器,复用 `geomQC`/`labelQC`/`wireLabelQC` + 新 T-DENSITY/T-ANNOT,每条返回 `{token,conform,deviations}`);refit `engine/commercial_judge.mjs` 为三层裁判(tier1 DRC / tier2 几何机械 / tier3 视觉残余)。

**Tech Stack:** Node ESM(`node --test`)、现有 `geom_qc`/`label_qc`/`wire_label_qc`/`bridge_windows`、`sch_Drc.check`、`getCurrentRenderedAreaImage`。无新依赖。

## Global Constraints

- **铁律:减偏差·消 AI 想象·机械符合 token**(见 `CLAUDE.md`/记忆 design-token-conformance-not-imagination)。能机械判的绝不靠视觉/想象。
- **token 值不发明、不放水**:严标取文档 DR(`docs/schematic-design-rules.md` DR1-18,如 T-ORTHO=100% 正交);RK3576 实测**仅**填 DR 未量化的量(密度/标注),**绝不**用"别人真板也不完美"给我们自己产出放水。
- **裁判输出无合成百分比**:只有"对哪条 token 符合/偏离 + 偏离处"。三层与门:DRC 0/0/0/0 → 每条几何 token → 视觉残余。
- 零特定电路内容(token 与代码全通用;RK3576/vibe-buddy 内容只本地用,不入库具体器件/网名/标题)。
- ESM、tab 缩进、`node --test`、fail-closed(桥/DRC/截图不可用绝不默认通过)。
- 模型 = snapshot 格式 `{components:[{designator,x,y,rotation,mirror,bbox,attrs,pins}], wires:[{net,line,attrs}], netflags, texts, rectangles}`;drc=`{error,warn,info}`。

### token 检查器统一返回形态
```js
// 每个 checkXxx(model) 返回:
{ token: 'T-ORTHO', conform: true|false, deviations: [ /* 偏离处:{kind, at, ...} */ ], detail: { /* 可读量 */ } }
```

---

### Task 1: design_tokens.mjs(token 单一真源)

**Files:**
- Create: `engine/design_tokens.mjs`
- Test: `engine/design_tokens.test.mjs`

**Interfaces:**
- Produces: `export const TOKENS`(数组,每条 `{id,category,desc,value,source,evidence,tier}`);`export function tokenById(id)`。

- [ ] **Step 1: Write the failing test**

```js
// engine/design_tokens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS, tokenById } from './design_tokens.mjs';

test('TOKENS 含核心 token 且字段完整', () => {
	const ids = TOKENS.map(t => t.id);
	for (const id of ['T-DRC','T-ORTHO','T-GRID','T-NOCROSS','T-NOTHRU','T-NOOVERLAP','T-DENSITY','T-ANNOT-PLACE','T-ANNOT-FULL','T-VISUAL']) {
		assert.ok(ids.includes(id), `缺 ${id}`);
	}
	for (const t of TOKENS) {
		assert.ok(t.category && t.desc && t.source, `${t.id} 缺字段`);
		assert.ok(['drc','geom','vision'].includes(t.evidence), `${t.id} evidence 非法`);
		assert.ok([1,2,3].includes(t.tier), `${t.id} tier 非法`);
	}
});

test('严标不放水:T-ORTHO=100、T-GRID=100、T-DRC 全0', () => {
	assert.equal(tokenById('T-ORTHO').value.minPct, 100);
	assert.equal(tokenById('T-GRID').value.minPct, 100);
	assert.deepEqual(tokenById('T-DRC').value, { error: 0, warn: 0, info: 0 });
});

test('能机械判的不归 vision:仅整体残余 T-VISUAL 是 vision/tier3', () => {
	for (const t of TOKENS) if (t.evidence === 'vision') assert.equal(t.tier, 3, `${t.id} vision 必 tier3`);
	assert.equal(tokenById('T-DENSITY').evidence, 'geom');
	assert.equal(tokenById('T-ANNOT-FULL').evidence, 'geom');
});

test('零特定电路字面量', () => {
	const src = TOKENS.map(t => t.desc + ' ' + t.source).join(' ');
	assert.doesNotMatch(src, /AMS1117|AO3400|ESP32|RK3576|RK806|VCC3V3_|VDD_CPU|vibe.?buddy/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/design_tokens.test.mjs`
Expected: FAIL（Cannot find module './design_tokens.mjs'）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/design_tokens.mjs
// 设计 token 单一真源(冻结)。严标取文档 DR1-18;RK3576 实测仅填 DR 未量化处。零特定电路内容。
// 铁律:能机械判的(geom/drc)绝不归 vision;tier3 仅整体视觉残余。值不发明、不放水。

export const TOKENS = [
	{ id: 'T-DRC',        category: '电气', desc: 'DRC 无 error/warn/info', value: { error: 0, warn: 0, info: 0 }, source: 'DR18', evidence: 'drc', tier: 1 },
	{ id: 'T-ORTHO',      category: '走线', desc: '导线全正交,零斜段',      value: { minPct: 100 }, source: 'DR1', evidence: 'geom', tier: 2 },
	{ id: 'T-NOCROSS',    category: '走线', desc: '异网/无名线不交叉不中段相接', value: { max: 0 }, source: 'DR2', evidence: 'geom', tier: 2 },
	{ id: 'T-NOTHRU',     category: '走线', desc: '线不穿件体/符号/文字/标签/flag/NC', value: { max: 0 }, source: 'DR3', evidence: 'geom', tier: 2 },
	{ id: 'T-NOOVERLAP',  category: '几何', desc: '可见对象间、对件体无重叠', value: { max: 0 }, source: 'DR4/5', evidence: 'geom', tier: 2 },
	{ id: 'T-GRID',       category: '栅格', desc: '脚坐标落统一栅格',        value: { grid: 5, minPct: 100 }, source: 'DR隐含/RK3576', evidence: 'geom', tier: 2 },
	{ id: 'T-DENSITY',    category: '紧凑', desc: '器件最近邻 pitch 达商用密度(治稀疏散布)', value: { medMax: 50, minNN: 15 }, source: 'RK3576', evidence: 'geom', tier: 2 },
	{ id: 'T-ANNOT-PLACE',category: '标注', desc: '标号+阻值在件外、同侧、错开堆叠', value: { outsidePct: 100, sameSideMinPct: 70 }, source: 'RK3576/CR-10', evidence: 'geom', tier: 2 },
	{ id: 'T-ANNOT-FULL', category: '标注', desc: '无源件带值标注(读属性机械判)', value: { minPct: 90 }, source: 'RK3576/CR-09', evidence: 'geom', tier: 2 },
	{ id: 'T-VISUAL',     category: '整体', desc: '整页视觉达 RK3576 残余 gestalt(几何量不到的整体专业度)', value: { ref: 'commercial' }, source: 'RK3576+DR', evidence: 'vision', tier: 3 },
];

export function tokenById(id) {
	return TOKENS.find(t => t.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/design_tokens.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add engine/design_tokens.mjs engine/design_tokens.test.mjs
git commit -m "feat: 设计 token 单一真源(严标DR1-18,密度/标注填RK3576,零放水)"
```

> 说明:T-DENSITY.medMax=50 取自 RK3576 商用单页最近邻 pitch 中位 ~40–45 留余量;T-FLOW/T-MODULE/T-LABEL-* 等 DR6-17 token 在后续计划切片接入现有 `wire_label_qc`/布局契约,本计划先落地框架 + 区分 vibe-buddy/RK3576 的关键 token(正交/栅格/密度/标注/重叠/穿越)。

---

### Task 2: token_conformance.mjs — 几何严标检查器(复用 geomQC)

**Files:**
- Create: `engine/token_conformance.mjs`
- Test: `engine/token_conformance.test.mjs`

**Interfaces:**
- Consumes: `tokenById`(Task 1)、`geomQC`(`engine/geom_qc.mjs`,返回 `{collinear,endpointShort,endpointOnWire,crossings,wireThruComp:[],wireThruPin:[],overlaps:[]}`)。
- Produces: `export function checkOrtho(model)`、`checkNoCross(model)`、`checkNoThru(model)`、`checkNoOverlap(model)`、`checkGrid(model)` —— 各返回 `{token,conform,deviations,detail}`。

- [ ] **Step 1: Write the failing test**

```js
// engine/token_conformance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOrtho, checkGrid } from './token_conformance.mjs';

test('T-ORTHO 严标:有1段斜线即不符合', () => {
	const r = checkOrtho({ wires: [{ line: [0,0,10,0] }, { line: [0,0,10,10] }] }); // 1正交1斜
	assert.equal(r.token, 'T-ORTHO');
	assert.equal(r.conform, false);
	assert.equal(r.deviations.length, 1);
});

test('T-ORTHO 全正交 → 符合', () => {
	const r = checkOrtho({ wires: [{ line: [0,0,10,0,10,10] }] });
	assert.equal(r.conform, true);
	assert.equal(r.deviations.length, 0);
});

test('T-GRID 严标:任一脚脱格即不符合', () => {
	const ok = checkGrid({ components: [{ pins: [{x:0,y:5},{x:10,y:15}] }] });
	assert.equal(ok.conform, true);
	const bad = checkGrid({ components: [{ pins: [{x:3,y:5}] }] });
	assert.equal(bad.conform, false);
	assert.equal(bad.deviations.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/token_conformance.test.mjs`
Expected: FAIL（Cannot find module './token_conformance.mjs'）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/token_conformance.mjs
// 逐 token 确定性符合检查器(严标,机械判,零特定电路内容)。复用 geomQC。
import { tokenById } from './design_tokens.mjs';
import { geomQC } from './geom_qc.mjs';

const res = (id, deviations, detail) => ({ token: id, conform: deviations.length === 0, deviations, detail });

// T-ORTHO:每段必 dx==0||dy==0,否则记偏离(严标 100%)。
export function checkOrtho(model) {
	const dev = [];
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const dx = l[i + 2] - l[i], dy = l[i + 3] - l[i + 1];
			if (dx !== 0 && dy !== 0) dev.push({ kind: 'diagonal-seg', at: [l[i], l[i + 1], l[i + 2], l[i + 3]] });
		}
	}
	return res('T-ORTHO', dev, { nonOrtho: dev.length });
}

// T-GRID:脚坐标必落 grid 倍数(严标 100%)。
export function checkGrid(model) {
	const g = tokenById('T-GRID').value.grid;
	const dev = [];
	for (const c of model.components || []) for (const p of c.pins || []) {
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
		if (p.x % g !== 0 || p.y % g !== 0) dev.push({ kind: 'off-grid-pin', at: [p.x, p.y] });
	}
	return res('T-GRID', dev, { grid: g, offGrid: dev.length });
}

// 以下复用 geomQC 的计数(DR2/3/4/5),严标 max=0。
function geomCounts(model) {
	const g = geomQC(model);
	return {
		cross: (g.crossings || 0),
		shorts: (g.collinear || 0) + (g.endpointShort || 0) + (g.endpointOnWire || 0),
		thru: (g.wireThruComp || []).length + (g.wireThruPin || []).length,
		overlap: (g.overlaps || []).length,
		raw: g,
	};
}
export function checkNoCross(model) { const c = geomCounts(model); return res('T-NOCROSS', c.cross ? [{ kind: 'crossing', n: c.cross }] : [], { crossings: c.cross, shorts: c.shorts }); }
export function checkNoThru(model)  { const c = geomCounts(model); return res('T-NOTHRU',  c.thru  ? [{ kind: 'wire-through-object', n: c.thru }] : [], { thru: c.thru }); }
export function checkNoOverlap(model){ const c = geomCounts(model); return res('T-NOOVERLAP', c.overlap ? [{ kind: 'overlap', n: c.overlap }] : [], { overlap: c.overlap }); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/token_conformance.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/token_conformance.mjs engine/token_conformance.test.mjs
git commit -m "feat: token 几何严标检查器(ortho100/grid100/nocross/nothru/nooverlap,复用geomQC)"
```

---

### Task 3: 新检查器 T-DENSITY + T-ANNOT-PLACE + T-ANNOT-FULL

**Files:**
- Modify: `engine/token_conformance.mjs`
- Test: `engine/token_conformance.test.mjs`

**Interfaces:**
- Consumes: `tokenById`。
- Produces: `export function checkDensity(model)`、`checkAnnotPlace(model)`、`checkAnnotFull(model)`。

- [ ] **Step 1: Write the failing test**

```js
import { checkDensity, checkAnnotFull } from './token_conformance.mjs';

test('T-DENSITY:间距太散(中位>50)→不符合', () => {
	const mk = x => ({ x, y: 0, bbox: { minX: x, minY: 0, maxX: x + 2, maxY: 2 }, pins: [] });
	const sparse = checkDensity({ components: [mk(0), mk(200), mk(400)] });
	assert.equal(sparse.token, 'T-DENSITY');
	assert.equal(sparse.conform, false);
	const dense = checkDensity({ components: [mk(0), mk(40), mk(80)] });
	assert.equal(dense.conform, true);
});

test('T-ANNOT-FULL:无源件缺值标注→不符合', () => {
	const withVal = { pins: [{},{}], attrs: [{ key: 'Name', valueVisible: true, value: '10k' }] };
	const bare    = { pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'R1' }] };
	assert.equal(checkAnnotFull({ components: [withVal] }).conform, true);
	assert.equal(checkAnnotFull({ components: [bare] }).conform, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/token_conformance.test.mjs`
Expected: FAIL（checkDensity is not a function）

- [ ] **Step 3: Write minimal implementation**

```js
// 追加到 engine/token_conformance.mjs
function bboxCenter(c) { return c.bbox ? [(c.bbox.minX + c.bbox.maxX) / 2, (c.bbox.minY + c.bbox.maxY) / 2] : [c.x, c.y]; }
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

// T-DENSITY:最近邻中心距中位 ≤ medMax 且 min ≥ minNN(治稀疏散布)。
export function checkDensity(model) {
	const v = tokenById('T-DENSITY').value;
	const cs = (model.components || []).map(bboxCenter).filter(p => Number.isFinite(p[0]));
	const dists = [];
	for (let i = 0; i < cs.length; i++) { let m = Infinity; for (let j = 0; j < cs.length; j++) { if (i === j) continue; const d = Math.hypot(cs[i][0] - cs[j][0], cs[i][1] - cs[j][1]); if (d < m) m = d; } if (m < Infinity) dists.push(m); }
	const med = +median(dists).toFixed(0), mn = dists.length ? +Math.min(...dists).toFixed(0) : 0;
	const dev = [];
	if (dists.length && med > v.medMax) dev.push({ kind: 'too-sparse', medNN: med, medMax: v.medMax });
	if (dists.length && mn < v.minNN) dev.push({ kind: 'too-crowded', minNN: mn });
	return res('T-DENSITY', dev, { medNN: med, minNN: mn, n: dists.length });
}

// T-ANNOT-PLACE:2脚件标号+阻值在件外、同侧(≥sameSideMinPct)。
export function checkAnnotPlace(model) {
	const v = tokenById('T-ANNOT-PLACE').value;
	let total = 0, outside = 0, pair = 0, same = 0;
	for (const c of model.components || []) {
		const pins = c.pins || []; if (pins.length !== 2 || !c.bbox) continue;
		const bb = c.bbox, bcx = (bb.minX + bb.maxX) / 2, bcy = (bb.minY + bb.maxY) / 2;
		const horiz = Math.abs((pins[0].x ?? 0) - (pins[1].x ?? 0)) >= Math.abs((pins[0].y ?? 0) - (pins[1].y ?? 0));
		const labs = (c.attrs || []).filter(a => (a.key === 'Designator' || a.key === 'Name') && a.valueVisible && Number.isFinite(a.x));
		const perp = a => horiz ? a.y - bcy : a.x - bcx;
		const inside = a => a.x >= bb.minX && a.x <= bb.maxX && a.y >= bb.minY && a.y <= bb.maxY;
		const d = labs.find(a => a.key === 'Designator'), n = labs.find(a => a.key === 'Name');
		for (const a of labs) { total++; if (!inside(a)) outside++; }
		if (d && n) { pair++; if (Math.sign(perp(d)) === Math.sign(perp(n)) && perp(d) !== 0) same++; }
	}
	const outsidePct = total ? +(outside / total * 100).toFixed(0) : 100;
	const sameSidePct = pair ? +(same / pair * 100).toFixed(0) : 100;
	const dev = [];
	if (outsidePct < v.outsidePct) dev.push({ kind: 'label-inside-body', outsidePct });
	if (sameSidePct < v.sameSideMinPct) dev.push({ kind: 'designator-value-not-same-side', sameSidePct });
	return res('T-ANNOT-PLACE', dev, { outsidePct, sameSidePct, n: total });
}

// T-ANNOT-FULL:2脚无源件须有可见值(Name)标注 ≥ minPct。
export function checkAnnotFull(model) {
	const v = tokenById('T-ANNOT-FULL').value;
	const passives = (model.components || []).filter(c => (c.pins || []).length === 2);
	let withVal = 0;
	for (const c of passives) if ((c.attrs || []).some(a => a.key === 'Name' && a.valueVisible && a.value)) withVal++;
	const pct = passives.length ? +(withVal / passives.length * 100).toFixed(0) : 100;
	const dev = pct < v.minPct ? [{ kind: 'passives-missing-value', pct, need: v.minPct }] : [];
	return res('T-ANNOT-FULL', dev, { pct, passives: passives.length });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/token_conformance.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/token_conformance.mjs engine/token_conformance.test.mjs
git commit -m "feat: T-DENSITY/T-ANNOT-PLACE/T-ANNOT-FULL 检查器(密度/标注机械判)"
```

---

### Task 4: 三层裁判 judgeTokens(无合成百分比)

**Files:**
- Modify: `engine/token_conformance.mjs`
- Test: `engine/token_conformance.test.mjs`

**Interfaces:**
- Consumes: 全部 checkXxx + `tokenById`。
- Produces: `export function checkDrc(drc)`(T-DRC)、`export function judgeTokens(model, { drc } = {})` → `{ tier1, tier2, tier3, deviationCount, conform }`(`conform` 当且仅当 tier1+tier2 全符合且 tier3 无已判不符合;**无任何百分比**)。

- [ ] **Step 1: Write the failing test**

```js
import { judgeTokens } from './token_conformance.mjs';

test('judgeTokens 三层结构、无百分比字段、DRC不为0则tier1不符合', () => {
	const rep = judgeTokens({ components: [], wires: [] }, { drc: { error: 0, warn: 24, info: 0 } });
	assert.ok(rep.tier1 && Array.isArray(rep.tier2) && Array.isArray(rep.tier3));
	assert.equal(rep.tier1.conform, false);      // 24 warn ≠ 0
	assert.equal(rep.conform, false);
	assert.equal(JSON.stringify(rep).includes('Pct') || JSON.stringify(rep).includes('percent'), true); // detail 里有 Pct 量,但…
	assert.equal(rep.score, undefined);          // 无合成分
	assert.equal(rep.commercialPass, undefined);  // 无旧式百分比/通过位
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/token_conformance.test.mjs`
Expected: FAIL（judgeTokens is not a function）

- [ ] **Step 3: Write minimal implementation**

```js
// 追加到 engine/token_conformance.mjs
export function checkDrc(drc = {}) {
	const v = tokenById('T-DRC').value;
	const fin = k => Number.isFinite(drc[k]) ? drc[k] : null;
	const e = fin('error'), w = fin('warn'), i = fin('info');
	const dev = [];
	if (e !== v.error) dev.push({ kind: 'drc-error', got: e });
	if (w !== v.warn) dev.push({ kind: 'drc-warn', got: w });
	if (i !== v.info) dev.push({ kind: 'drc-info', got: i });
	return res('T-DRC', dev, { error: e, warn: w, info: i });
}

// tier3 视觉残余:几何量不到,留待 AI 对 RK3576 按 checklist 判;此处只占位"待视觉",不臆测符合。
function tier3Pending() {
	return [{ token: 'T-VISUAL', conform: null, deviations: [], detail: { note: '待与 RK3576 并排视觉对照(见 commercial_judge runLiveJudge shots)' } }];
}

export function judgeTokens(model, { drc } = {}) {
	const tier1 = checkDrc(drc);
	const tier2 = [
		checkOrtho(model), checkGrid(model), checkNoCross(model), checkNoThru(model), checkNoOverlap(model),
		checkDensity(model), checkAnnotPlace(model), checkAnnotFull(model),
	];
	const tier3 = tier3Pending();
	const tier2bad = tier2.filter(r => !r.conform);
	const deviationCount = (tier1.conform ? 0 : tier1.deviations.length) + tier2bad.reduce((s, r) => s + r.deviations.length, 0);
	// conform:tier1+tier2 全符合(tier3 视觉由 live 层补判,非 pending 即纳入)
	const conform = tier1.conform && tier2bad.length === 0;
	return { tier1, tier2, tier3, deviationCount, conform };
}
```

> 注:Step 1 那条 `includes('Pct')` 断言写法绕,改成清晰版:

```js
test('judgeTokens 三层结构、无合成分、DRC≠0则不符合', () => {
	const rep = judgeTokens({ components: [], wires: [] }, { drc: { error: 0, warn: 24, info: 0 } });
	assert.ok(rep.tier1 && Array.isArray(rep.tier2) && Array.isArray(rep.tier3));
	assert.equal(rep.tier1.conform, false);
	assert.equal(rep.conform, false);
	assert.equal(rep.score, undefined);
	assert.equal(rep.commercialPass, undefined);
	assert.ok(rep.tier2.find(r => r.token === 'T-ORTHO'));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/token_conformance.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/token_conformance.mjs engine/token_conformance.test.mjs
git commit -m "feat: judgeTokens 三层符合裁判(T-DRC底线+tier2几何+tier3视觉占位,无合成分)"
```

---

### Task 5: refit commercial_judge → 三层实时裁判 + 视觉证据

**Files:**
- Modify: `engine/commercial_judge.mjs`
- Test: `engine/commercial_judge.test.mjs`

**Interfaces:**
- Consumes: `judgeTokens`(Task 4)、现有 `readGeometry`/`captureRegion`/`regionFromParts`(bridge_windows)、`runDrc`(已存在于 commercial_judge)。
- Produces: `export function judgeBoardTokens(model, { drc, shots = [] } = {})` → `{ ...judgeTokens(...), shots }`;refit `runLiveJudge` 输出三层 + tier3 截图路径(供 AI 对 RK3576 视觉判)。保留旧 `judgeBoard`/`runLiveJudge` 调用点不破坏(内部改调 judgeTokens)。

- [ ] **Step 1: Write the failing test**

```js
import { judgeBoardTokens } from './commercial_judge.mjs';

test('judgeBoardTokens 三层 + shots 透传,DRC脏→不符合', () => {
	const rep = judgeBoardTokens({ components: [], wires: [] }, { drc: { error: 1, warn: 0, info: 0 }, shots: ['/tmp/x.png'] });
	assert.equal(rep.conform, false);
	assert.equal(rep.tier1.conform, false);
	assert.deepEqual(rep.shots, ['/tmp/x.png']);
	assert.equal(rep.score, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_judge.test.mjs`
Expected: FAIL（judgeBoardTokens is not a function）

- [ ] **Step 3: Write minimal implementation**

```js
// 在 engine/commercial_judge.mjs 顶部 import 追加:
import { judgeTokens } from './token_conformance.mjs';

// 新增导出:
export function judgeBoardTokens(model, { drc, shots = [] } = {}) {
	const j = judgeTokens(model, { drc });
	return { ...j, shots };
}
```

```js
// refit runLiveJudge 的报告组装:把 judgeBoard(...) 换成 judgeBoardTokens(...),
// 写出文件时包含三层 + drc + shots(tier3 截图供 AI 对 RK3576 视觉判),不写任何百分比:
//   const report = judgeBoardTokens(model, { drc, shots });
//   writeFileSync(`${outDir}/judge_report.json`, JSON.stringify({ ...report, drc }, null, 2), 'utf8');
// (mkdirSync 仍在 captureRegion 之前;fail-closed:readGeometry/runDrc 失败照旧 reject。)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_judge.test.mjs`（含既有 fail-closed 测试)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_judge.mjs engine/commercial_judge.test.mjs
git commit -m "feat: commercial_judge 接 judgeTokens 三层裁判(无合成分,tier3带视觉证据)"
```

---

### Task 6: 双向验证(vibe-buddy 必判挂 / RK3576 判别正确)+ 弃软尺 + 文档

**Files:**
- Modify: `engine/commercial_rubric.mjs`(标记 `scoreAll`/软 THRESHOLDS 为 deprecated,不再作通过依据)
- Modify: `bin/plexus.mjs`(`judge` 命令改用 judgeBoardTokens / judgeTokens 离线;打印三层 deviation,退出码按 `conform`)
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 全部前序。

- [ ] **Step 1: 全套测试零回归**

Run: `npm test`
Expected: 全绿(原有 + design_tokens/token_conformance 新测试),0 fail。

- [ ] **Step 2: 接 CLI 离线 token 评估 + 跑双向验证**

把 `bin/plexus.mjs` 的 `judge` 离线分支改为:
```js
		const { judgeTokens } = await import('../engine/token_conformance.mjs');
		const snap = args.find(a => /\.json$/.test(a));
		if (!snap) { console.error('用法: plexus judge <snapshot.json> | judge --live'); process.exit(2); }
		const model = JSON.parse(readFileSync(snap, 'utf8').replace(/^﻿/, ''));
		const rep = judgeTokens(model, {});  // 离线无DRC→T-DRC不符合(诚实:无真DRC不认达标)
		console.log('tier1 DRC:', rep.tier1.conform ? '符合' : '不符合', rep.tier1.detail);
		for (const r of rep.tier2) console.log(`  ${r.token}: ${r.conform ? '符合' : '✗ 偏离'} ${JSON.stringify(r.detail)}`);
		console.log('tier3 视觉:', '待并排RK3576判');
		console.log(rep.conform ? '符合(待视觉)' : `不符合,偏离 ${rep.deviationCount} 处`);
		process.exit(rep.conform ? 0 : 1);
```
Run（需桥 + EDA 开 vibe-buddy 与 RK3576;由控制者执行,见验收):
- vibe-buddy 实时三层判 → **必须 tier1 不符合(warn≠0)+ tier2 多条偏离(T-ORTHO 有斜段/T-DENSITY 太散/T-ANNOT-PLACE 不同侧/T-MODULE 缺)**,绝非"达标"。
- RK3576 实时三层判 → tier1/tier2 大体符合(真商用),tier3 视觉对照符合。
Expected: vibe-buddy 被诚实判挂、RK3576 判别正确。

- [ ] **Step 3: 标记旧软尺 deprecated**

在 `engine/commercial_rubric.mjs` 顶部加注释,并在 `scoreAll` 上方加:
```js
// DEPRECATED(2026-06-23):scoreAll 与软阈值(ORTHO_MIN_PCT=80 等)是放水的"打分式"旧裁判,
// 已被 token_conformance.judgeTokens(严标DR1-18 + 三层确定性符合)取代。保留仅为历史,勿用于通过判定。
```

- [ ] **Step 4: 更新 AGENTS.md**

在架构清单把"商用级裁判"一行改为:
```markdown
- `engine/design_tokens.mjs` / `engine/token_conformance.mjs` / `engine/commercial_judge.mjs` —
  设计 token 单一真源(严标 DR1-18,密度/标注填 RK3576 实测)+ 对 token 的确定性符合裁判:
  三层(DRC 0/0/0/0 → 每条几何 token → 视觉达 RK3576),输出 deviation 清单,无合成百分比。
```

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs bin/plexus.mjs AGENTS.md
git commit -m "refactor: judge 全面切到 token 严标确定性符合;弃软尺scoreAll;双向验证(vibe-buddy挂/RK3576对)"
```

---

## Self-Review

**1. Spec coverage(对 spec §1-§10):**
- §4 token 单一真源 → Task 1 ✓(核心 token;DR6-17 的 T-MODULE/T-FLOW/T-LABEL-* 在 Task 1 说明里标为后续切片接入现有 wire_label_qc/布局契约——本计划落地框架 + 区分 vibe-buddy/RK3576 的关键 token)。
- §5 确定性符合裁判(几何机械/DRC/视觉残余)→ Task 2-5 ✓
- §3 无合成百分比 → Task 4/5 断言 `score===undefined`/`commercialPass===undefined` ✓
- §3 严标不放水(T-ORTHO=100)→ Task 1/2 ✓
- §9 验收:vibe-buddy 判挂 + RK3576 判别 → Task 6 Step 2 ✓
- fail-closed → 复用既修,Task 5 保留 ✓

**2. Placeholder scan:** 已把 Task 4 Step1 绕口断言换清晰版。DR6-17 完整 token 明确标为"后续切片",非本计划占位(本计划交付可工作的框架 + 关键 token,这是合理切片,见 §4 注)。

**3. Type consistency:** `{token,conform,deviations,detail}` 贯穿 Task 2-5;`judgeTokens→{tier1,tier2,tier3,deviationCount,conform}` 在 Task 4/5/6 一致;`tokenById(id).value.{minPct|grid|...}` 字段名与 Task 1 TOKENS 定义一致。

**已知切片边界:** 本计划交付 token 框架 + tier1/tier2 关键几何机械检查(足以让 vibe-buddy 诚实判挂、RK3576 判别正确)+ tier3 视觉证据接口。**DR6-17 的完整 token(T-MODULE/T-FLOW/T-LABEL-BUDGET/REAL/ENDPOINT/ALIGN/NOPORT)是下一计划切片**(复用现有 `wire_label_qc`/布局契约接入),因它们多依赖 layoutPolicy(生成器产物),更适合与 Spec B 生成器同期。tier3 真·AI 视觉对照由控制者在执行期对 RK3576 并排判,不在 `node --test` 内。

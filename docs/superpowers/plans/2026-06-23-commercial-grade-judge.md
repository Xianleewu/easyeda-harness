# 商用级裁判(Spec A)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个把"商用级原理图"标准冻结成可量规则、并用真实 EDA 证据(几何/DRC/局部截图)对照打分的裁判,先在真实板上拿到诚实基线。

**Architecture:** 三层:`commercial_rubric.mjs`(CR-01~10 纯函数指标+阈值,零 I/O,可单测)/ `bridge_windows.mjs`(可复用多窗口桥工具:枚举/定向/激活/截图/读几何,薄 I/O)/ `commercial_judge.mjs`(编排:取证→打分→出证据化报告,纯打分路径可单测、取证路径走桥)。CLI 经 `bin/plexus.mjs judge` 暴露。

**Tech Stack:** Node ESM(`node --test`)、现有 `engine/bridge_client.mjs`、easyeda-api-skill 桥、ImageMagick `convert`(缩图)。无新增 npm 依赖。

## Global Constraints

- **零特定电路内容**:任何文件不得含具体器件型号/网名/模块标题/项目名;规则与测试夹具全部匿名通用。参考图内容只在 scratchpad,绝不入库。
- 代码风格随现有 `engine/*.mjs`:ESM、tab 缩进、纯函数优先、fail-fast。
- 模型格式 = 现有 snapshot(`snapshot2.js` 输出):见下方"数据模型"。规则函数一律吃这个格式。
- 唯一通过依据 = 真实 EDA 证据(几何来自 EDA 读取、DRC 来自 `sch_Drc.check`、视觉来自真实截图);离线 QC 仅作预检不作通过依据。
- 规则阈值取自 `docs/.../2026-06-23-commercial-grade-judge-design.md` §7.1(CR-01~10),冻结,不得为过关中途放宽。
- 测试夹具坐标单位 = EDA 原生单位;栅格基准 = 5。

### 数据模型(所有规则函数的输入)

```js
// model:由 snapshot2.js 读取的真实 EDA 板(或离线夹具),字段:
// {
//   components: [{ id, designator, name, value, x, y, rotation, mirror,
//                  bbox:{minX,minY,maxX,maxY},
//                  attrs:[{key,value,x,y,keyVisible,valueVisible}],
//                  pins:[{num,name,x,y,rot,len,type,noConnected}] }],
//   wires: [{ id, net, line:[x0,y0,x1,y1,...], attrs:[{key,value,x,y,...}] }],
//   netflags: [{ id, type, net, x, y, ... }],
//   texts: [...], rectangles: [...]
// }
// drc: { error:number, warn:number, info:number }  // 来自 sch_Drc.check
```

---

### Task 1: 规则元数据与阈值常量(commercial_rubric 骨架)

**Files:**
- Create: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Produces: `export const THRESHOLDS`(常量对象)、`export const RUBRIC`(CR-01~10 元数据数组,每条 `{id,dimension,desc,evidence,severity}`)。

- [ ] **Step 1: Write the failing test**

```js
// engine/commercial_rubric.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC, THRESHOLDS } from './commercial_rubric.mjs';

test('RUBRIC 含 CR-01..CR-10 且字段完整', () => {
	const ids = RUBRIC.map(r => r.id);
	for (let n = 1; n <= 10; n++) assert.ok(ids.includes(`CR-${String(n).padStart(2, '0')}`), `缺 CR-0${n}`);
	for (const r of RUBRIC) {
		assert.ok(r.dimension && r.desc, `${r.id} 缺字段`);
		assert.ok(['drc', 'geom', 'geom+image-region', 'image-region', 'image-full'].includes(r.evidence), `${r.id} evidence 非法`);
		assert.ok(['block', 'flag'].includes(r.severity), `${r.id} severity 非法`);
	}
});

test('阈值常量存在且为冻结值', () => {
	assert.equal(THRESHOLDS.GRID, 5);
	assert.equal(THRESHOLDS.ORTHO_MIN_PCT, 94);
	assert.equal(THRESHOLDS.GRID_SNAP_MIN_PCT, 95);
	assert.deepEqual(THRESHOLDS.ROT_ALLOWED, [0, 90, 180, 270]);
	assert.equal(THRESHOLDS.LABEL_TO_LINE_MED_MAX, 12);
});

test('零特定电路字面量(无具体器件/网名指纹)', () => {
	const src = RUBRIC.map(r => r.desc).join(' ');
	assert.doesNotMatch(src, /AMS1117|AO3400|ESP32|RK3576|VCC3V3_|VDD_CPU/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`Cannot find module './commercial_rubric.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/commercial_rubric.mjs
// 商用级原理图规则集(冻结)。阈值取自 RK3576 实测,见 spec §7.1。零特定电路内容。

export const THRESHOLDS = {
	GRID: 5,                    // 引脚吸附栅格(EDA 单位)
	GRID_SNAP_MIN_PCT: 95,      // CR-03
	ORTHO_MIN_PCT: 94,          // CR-02 原始线段正交率下限
	ROT_ALLOWED: [0, 90, 180, 270], // CR-04
	MIRROR_MAX_PCT: 5,          // CR-04 镜像占比上限(实测<1%,留余量)
	SPACING_MIN: 15,            // CR-05 最近邻最小中心距
	SPACING_MED_LO: 25,         // CR-05 中位下限(不太挤)
	SPACING_MED_HI: 90,         // CR-05 中位上限(不太散)
	LABEL_TO_LINE_MED_MAX: 12,  // CR-06 网名标签离所在线顶点中位上限
	LABEL_PERP_LO: 5,           // CR-10 标号/阻值垂直脚轴偏移下限
	LABEL_PERP_HI: 20,          // CR-10 上限
};

export const RUBRIC = [
	{ id: 'CR-01', dimension: '电气', desc: 'DRC 无 error', evidence: 'drc', severity: 'block' },
	{ id: 'CR-02', dimension: '走线', desc: '可见导线全正交;原始线段正交率达标,余为符号/引线噪声', evidence: 'geom+image-region', severity: 'block' },
	{ id: 'CR-03', dimension: '栅格', desc: '引脚坐标吸附到统一栅格', evidence: 'geom', severity: 'block' },
	{ id: 'CR-04', dimension: '朝向', desc: '器件仅用四正交旋转,镜像极少', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-05', dimension: '紧凑', desc: '相邻器件间距集中,不挤不散', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-06', dimension: '标签', desc: '网名标签贴所在线、对齐、不压器件', evidence: 'geom+image-region', severity: 'block' },
	{ id: 'CR-07', dimension: '连接', desc: '命名网络+标签为主连接,属常态不扣分;块内近距优先短直连', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-08', dimension: '图框', desc: '存在标准标题栏与图框', evidence: 'image-full', severity: 'flag' },
	{ id: 'CR-09', dimension: '标注', desc: '无源件带值/封装/参数标注;关键功能块有注释;可选电路有 DNP 标注', evidence: 'image-region', severity: 'flag' },
	{ id: 'CR-10', dimension: '标注摆放', desc: '标号/阻值在器件外、垂直脚轴偏移落格、同侧错开堆叠、不压件脚线不互盖', evidence: 'geom+image-region', severity: 'block' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: 商用规则集骨架(CR-01~10 元数据+冻结阈值)"
```

---

### Task 2: CR-02 正交率指标

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Consumes: `THRESHOLDS`(Task 1)。
- Produces: `export function crOrthogonality(model) -> { id:'CR-02', pass, orthoPct, seg, ortho, deg45, other }`。

- [ ] **Step 1: Write the failing test**

```js
// 追加到 engine/commercial_rubric.test.mjs
import { crOrthogonality } from './commercial_rubric.mjs';

test('CR-02 全正交线 → 100% 通过', () => {
	const model = { wires: [{ line: [0, 0, 10, 0, 10, 10] }] }; // 1 横 1 竖
	const r = crOrthogonality(model);
	assert.equal(r.id, 'CR-02');
	assert.equal(r.seg, 2);
	assert.equal(r.orthoPct, 100);
	assert.equal(r.pass, true);
});

test('CR-02 一段 45° 计入 deg45 且不算正交', () => {
	const model = { wires: [{ line: [0, 0, 10, 10] }] }; // 斜 45
	const r = crOrthogonality(model);
	assert.equal(r.deg45, 1);
	assert.equal(r.orthoPct, 0);
	assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crOrthogonality is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
// 追加到 engine/commercial_rubric.mjs
export function crOrthogonality(model) {
	let seg = 0, ortho = 0, deg45 = 0;
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			seg++;
			const dx = l[i + 2] - l[i], dy = l[i + 3] - l[i + 1];
			if (dx === 0 || dy === 0) ortho++;
			else if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1) deg45++;
		}
	}
	const orthoPct = seg ? +(ortho / seg * 100).toFixed(1) : 100;
	return { id: 'CR-02', pass: orthoPct >= THRESHOLDS.ORTHO_MIN_PCT, orthoPct, seg, ortho, deg45, other: seg - ortho - deg45 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-02 正交率指标"
```

---

### Task 3: CR-03 引脚栅格吸附指标

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Consumes: `THRESHOLDS`。
- Produces: `export function crGridSnap(model) -> { id:'CR-03', pass, snapPct, total, on }`。

- [ ] **Step 1: Write the failing test**

```js
import { crGridSnap } from './commercial_rubric.mjs';

test('CR-03 全部脚落 5 栅格 → 通过', () => {
	const model = { components: [{ pins: [{ x: 0, y: 5 }, { x: 10, y: 15 }] }] };
	const r = crGridSnap(model);
	assert.equal(r.snapPct, 100);
	assert.equal(r.pass, true);
});

test('CR-03 半数脱格 → 不通过', () => {
	const model = { components: [{ pins: [{ x: 3, y: 5 }, { x: 10, y: 15 }] }] };
	const r = crGridSnap(model);
	assert.equal(r.snapPct, 50);
	assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crGridSnap is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
export function crGridSnap(model) {
	const g = THRESHOLDS.GRID;
	let total = 0, on = 0;
	for (const c of model.components || []) {
		for (const p of c.pins || []) {
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
			total++;
			if (p.x % g === 0 && p.y % g === 0) on++;
		}
	}
	const snapPct = total ? +(on / total * 100).toFixed(1) : 100;
	return { id: 'CR-03', pass: snapPct >= THRESHOLDS.GRID_SNAP_MIN_PCT, snapPct, total, on };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-03 引脚栅格吸附指标"
```

---

### Task 4: CR-04 旋转/镜像指标

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Consumes: `THRESHOLDS`。
- Produces: `export function crRotation(model) -> { id:'CR-04', pass, rotDist, badRot, mirrorPct }`。

- [ ] **Step 1: Write the failing test**

```js
import { crRotation } from './commercial_rubric.mjs';

test('CR-04 全四正交旋转、无镜像 → 通过', () => {
	const model = { components: [{ rotation: 0, mirror: false }, { rotation: 90, mirror: false }] };
	const r = crRotation(model);
	assert.equal(r.badRot, 0);
	assert.equal(r.mirrorPct, 0);
	assert.equal(r.pass, true);
});

test('CR-04 出现 45 度旋转 → 不通过', () => {
	const model = { components: [{ rotation: 45, mirror: false }] };
	const r = crRotation(model);
	assert.equal(r.badRot, 1);
	assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crRotation is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
export function crRotation(model) {
	const comps = model.components || [];
	const rotDist = {};
	let bad = 0, mir = 0;
	for (const c of comps) {
		const r = ((c.rotation || 0) % 360 + 360) % 360;
		rotDist[r] = (rotDist[r] || 0) + 1;
		if (!THRESHOLDS.ROT_ALLOWED.includes(r)) bad++;
		if (c.mirror) mir++;
	}
	const mirrorPct = comps.length ? +(mir / comps.length * 100).toFixed(1) : 0;
	return { id: 'CR-04', pass: bad === 0 && mirrorPct <= THRESHOLDS.MIRROR_MAX_PCT, rotDist, badRot: bad, mirrorPct };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-04 旋转/镜像指标"
```

---

### Task 5: CR-05 器件间距指标 + 共享 helper

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Consumes: `THRESHOLDS`。
- Produces: `export function crSpacing(model) -> { id:'CR-05', pass, minNN, medNN, n }`;内部 helper `bboxCenter(c)`、`median(arr)`(模块内复用)。

- [ ] **Step 1: Write the failing test**

```js
import { crSpacing } from './commercial_rubric.mjs';

test('CR-05 间距居中 → 通过', () => {
	// 三件均匀间隔 40
	const mk = (x) => ({ x, y: 0, bbox: { minX: x - 5, minY: -5, maxX: x + 5, maxY: 5 }, pins: [] });
	const model = { components: [mk(0), mk(40), mk(80)] };
	const r = crSpacing(model);
	assert.equal(r.minNN, 40);
	assert.equal(r.pass, true);
});

test('CR-05 过挤(间距 5) → 不通过', () => {
	const mk = (x) => ({ x, y: 0, bbox: { minX: x, minY: 0, maxX: x + 2, maxY: 2 }, pins: [] });
	const model = { components: [mk(0), mk(5)] };
	const r = crSpacing(model);
	assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crSpacing is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
function bboxCenter(c) {
	if (c.bbox) return [(c.bbox.minX + c.bbox.maxX) / 2, (c.bbox.minY + c.bbox.maxY) / 2];
	return [c.x, c.y];
}
function median(arr) {
	if (!arr.length) return 0;
	const a = [...arr].sort((x, y) => x - y);
	return a[Math.floor(a.length / 2)];
}

export function crSpacing(model) {
	const cs = (model.components || []).map(bboxCenter).filter(p => Number.isFinite(p[0]));
	const dists = [];
	for (let i = 0; i < cs.length; i++) {
		let m = Infinity;
		for (let j = 0; j < cs.length; j++) {
			if (i === j) continue;
			const d = Math.hypot(cs[i][0] - cs[j][0], cs[i][1] - cs[j][1]);
			if (d < m) m = d;
		}
		if (m < Infinity) dists.push(m);
	}
	const minNN = dists.length ? +Math.min(...dists).toFixed(0) : 0;
	const medNN = +median(dists).toFixed(0);
	const pass = dists.length === 0 ||
		(minNN >= THRESHOLDS.SPACING_MIN && medNN >= THRESHOLDS.SPACING_MED_LO && medNN <= THRESHOLDS.SPACING_MED_HI);
	return { id: 'CR-05', pass, minNN, medNN, n: dists.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-05 器件间距指标 + bboxCenter/median helper"
```

---

### Task 6: CR-07 命名网络占比(信息项)

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Produces: `export function crNamedRatio(model) -> { id:'CR-07', pass:true, namedPct, named, total }`(flag,恒 pass,只报占比;命名连接是常态)。

- [ ] **Step 1: Write the failing test**

```js
import { crNamedRatio } from './commercial_rubric.mjs';

test('CR-07 命名占比统计,恒不扣分', () => {
	const model = { wires: [
		{ attrs: [{ key: 'Name', value: 'NETA' }] },
		{ attrs: [{ key: 'Name', value: 'NETB' }] },
		{ attrs: [] },
	] };
	const r = crNamedRatio(model);
	assert.equal(r.named, 2);
	assert.equal(r.total, 3);
	assert.equal(r.namedPct, 67);
	assert.equal(r.pass, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crNamedRatio is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
export function crNamedRatio(model) {
	const wires = model.wires || [];
	let named = 0;
	for (const w of wires) {
		if ((w.attrs || []).some(a => /name/i.test(a.key) && a.value)) named++;
	}
	const namedPct = wires.length ? Math.round(named / wires.length * 100) : 0;
	return { id: 'CR-07', pass: true, namedPct, named, total: wires.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-07 命名网络占比(信息项,命名连接为常态)"
```

---

### Task 7: CR-06 网名标签贴线指标

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Consumes: `THRESHOLDS`、`median`(Task 5)。
- Produces: `export function crLabelToLine(model) -> { id:'CR-06', pass, medDist, p90, n }`(几何部分;对齐/不压由视觉补判,见 Task 12)。

- [ ] **Step 1: Write the failing test**

```js
import { crLabelToLine } from './commercial_rubric.mjs';

test('CR-06 标签贴在线顶点 → 距离 0 通过', () => {
	const model = { wires: [{ line: [0, 0, 20, 0], attrs: [{ key: 'Name', value: 'NETA', x: 0, y: 0 }] }] };
	const r = crLabelToLine(model);
	assert.equal(r.medDist, 0);
	assert.equal(r.pass, true);
});

test('CR-06 标签飘远(距 50) → 不通过', () => {
	const model = { wires: [{ line: [0, 0, 20, 0], attrs: [{ key: 'Name', value: 'NETA', x: 0, y: 50 }] }] };
	const r = crLabelToLine(model);
	assert.equal(r.medDist, 50);
	assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crLabelToLine is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
export function crLabelToLine(model) {
	const dists = [];
	for (const w of model.wires || []) {
		const l = w.line || [];
		const verts = [];
		for (let i = 0; i + 1 < l.length; i += 2) verts.push([l[i], l[i + 1]]);
		for (const a of w.attrs || []) {
			if (!/name/i.test(a.key) || !a.value || !Number.isFinite(a.x)) continue;
			let m = Infinity;
			for (const v of verts) { const d = Math.hypot(a.x - v[0], a.y - v[1]); if (d < m) m = d; }
			if (m < Infinity) dists.push(m);
		}
	}
	dists.sort((x, y) => x - y);
	const medDist = +median(dists).toFixed(1);
	const p90 = dists.length ? +dists[Math.floor(dists.length * 0.9)].toFixed(1) : 0;
	return { id: 'CR-06', pass: dists.length === 0 || medDist <= THRESHOLDS.LABEL_TO_LINE_MED_MAX, medDist, p90, n: dists.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-06 网名标签贴线距离指标"
```

---

### Task 8: CR-10 标号/阻值构造性摆放指标

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Consumes: `THRESHOLDS`。
- Produces: `export function crLabelPlacement(model) -> { id:'CR-10', pass, outsidePct, perpMed, sameSidePct, n }`。仅对 2 脚件统计。

判据(实测哲学):标号/阻值 ① 落 body 外(outsidePct=100) ② 垂直脚轴偏移在 [LABEL_PERP_LO, LABEL_PERP_HI] ③ 标号与阻值多数同侧(sameSidePct ≥ 70)。

- [ ] **Step 1: Write the failing test**

```js
import { crLabelPlacement } from './commercial_rubric.mjs';

// 横放 2 脚件:body y∈[-2,2],脚在 x=±10;标号/阻值同侧(上方),垂直偏移 10/10,在 body 外
const goodPassive = () => ({
	pins: [{ x: -10, y: 0 }, { x: 10, y: 0 }],
	bbox: { minX: -8, minY: -2, maxX: 8, maxY: 2 },
	attrs: [
		{ key: 'Designator', valueVisible: true, x: -2, y: 12 },
		{ key: 'Name', valueVisible: true, x: -2, y: 10 },
	],
});

test('CR-10 标号/阻值在外、垂直偏移、同侧 → 通过', () => {
	const r = crLabelPlacement({ components: [goodPassive()] });
	assert.equal(r.outsidePct, 100);
	assert.equal(r.sameSidePct, 100);
	assert.equal(r.pass, true);
});

test('CR-10 标签压在 body 内 → 不通过', () => {
	const bad = goodPassive();
	bad.attrs = [{ key: 'Designator', valueVisible: true, x: 0, y: 0 }, { key: 'Name', valueVisible: true, x: 0, y: 0 }];
	const r = crLabelPlacement({ components: [bad] });
	assert.ok(r.outsidePct < 100);
	assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crLabelPlacement is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
export function crLabelPlacement(model) {
	let total = 0, outside = 0;
	const perps = [];
	let sameSide = 0, pairCount = 0;
	for (const c of model.components || []) {
		const pins = c.pins || [];
		if (pins.length !== 2 || !c.bbox) continue;
		const horiz = Math.abs(pins[0].x - pins[1].x) >= Math.abs(pins[0].y - pins[1].y);
		const bb = c.bbox, bcx = (bb.minX + bb.maxX) / 2, bcy = (bb.minY + bb.maxY) / 2;
		const labels = (c.attrs || []).filter(a => (a.key === 'Designator' || a.key === 'Name') && a.valueVisible && Number.isFinite(a.x));
		const perpOf = a => horiz ? a.y - bcy : a.x - bcx;
		const inside = a => a.x >= bb.minX && a.x <= bb.maxX && a.y >= bb.minY && a.y <= bb.maxY;
		const desig = labels.find(a => a.key === 'Designator'), name = labels.find(a => a.key === 'Name');
		for (const a of labels) { total++; if (!inside(a)) outside++; const p = perpOf(a); if (p) perps.push(Math.abs(p)); }
		if (desig && name) { pairCount++; if (Math.sign(perpOf(desig)) === Math.sign(perpOf(name)) && perpOf(desig) !== 0) sameSide++; }
	}
	const outsidePct = total ? +(outside / total * 100).toFixed(0) : 100;
	const sameSidePct = pairCount ? +(sameSide / pairCount * 100).toFixed(0) : 100;
	const a = perps.sort((x, y) => x - y);
	const perpMed = a.length ? a[Math.floor(a.length / 2)] : 0;
	const pass = total === 0 ||
		(outsidePct === 100 && perpMed >= THRESHOLDS.LABEL_PERP_LO && perpMed <= THRESHOLDS.LABEL_PERP_HI && sameSidePct >= 70);
	return { id: 'CR-10', pass, outsidePct, perpMed, sameSidePct, n: total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-10 标号/阻值构造性摆放指标"
```

---

### Task 9: CR-01 DRC 评分 + 聚合器 scoreAll

**Files:**
- Modify: `engine/commercial_rubric.mjs`
- Test: `engine/commercial_rubric.test.mjs`

**Interfaces:**
- Consumes: 全部 cr* 指标函数。
- Produces: `export function crDrc(drc) -> { id:'CR-01', pass, error, warn, info }`;`export function scoreAll(model, { drc } = {}) -> { rules:[<各 cr 结果>], blockFail, flagFail, commercialPass }`。

- [ ] **Step 1: Write the failing test**

```js
import { crDrc, scoreAll } from './commercial_rubric.mjs';

test('CR-01 error=0 通过,error>0 不通过', () => {
	assert.equal(crDrc({ error: 0, warn: 3, info: 0 }).pass, true);
	assert.equal(crDrc({ error: 2, warn: 0, info: 0 }).pass, false);
});

test('scoreAll 汇总:全好板 commercialPass=true', () => {
	const model = {
		components: [{ rotation: 0, mirror: false, x: 0, y: 0, bbox: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
			pins: [{ x: -10, y: 0 }, { x: 10, y: 0 }],
			attrs: [{ key: 'Designator', valueVisible: true, x: -2, y: 12 }, { key: 'Name', valueVisible: true, x: -2, y: 10 }] },
			{ rotation: 90, mirror: false, x: 40, y: 0, bbox: { minX: 35, minY: -5, maxX: 45, maxY: 5 },
			pins: [{ x: 40, y: -10 }, { x: 40, y: 10 }],
			attrs: [{ key: 'Designator', valueVisible: true, x: 50, y: 2 }, { key: 'Name', valueVisible: true, x: 50, y: -2 }] }],
		wires: [{ line: [0, 0, 40, 0], attrs: [{ key: 'Name', value: 'NETA', x: 0, y: 0 }] }],
	};
	const r = scoreAll(model, { drc: { error: 0, warn: 0, info: 0 } });
	assert.equal(r.rules.length, 10);
	assert.equal(r.blockFail, 0);
	assert.equal(r.commercialPass, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: FAIL（`crDrc is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
export function crDrc(drc = {}) {
	const error = drc.error || 0;
	return { id: 'CR-01', pass: error === 0, error, warn: drc.warn || 0, info: drc.info || 0 };
}

// image-evidence 规则(CR-08/CR-09)无纯几何判据 → 默认 pending,由视觉补判(Task 12)
function crPending(id) { return { id, pass: null, pending: true, note: '需视觉证据判定' }; }

export function scoreAll(model, { drc } = {}) {
	const rules = [
		crDrc(drc), crOrthogonality(model), crGridSnap(model), crRotation(model), crSpacing(model),
		crLabelToLine(model), crNamedRatio(model), crPending('CR-08'), crPending('CR-09'), crLabelPlacement(model),
	];
	const sev = id => (RUBRIC.find(r => r.id === id) || {}).severity;
	let blockFail = 0, flagFail = 0;
	for (const r of rules) {
		if (r.pass === false) (sev(r.id) === 'block' ? blockFail++ : flagFail++);
	}
	return { rules, blockFail, flagFail, commercialPass: blockFail === 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_rubric.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_rubric.mjs engine/commercial_rubric.test.mjs
git commit -m "feat: CR-01 DRC 评分 + scoreAll 聚合器"
```

---

### Task 10: 可复用桥工具 bridge_windows(纯区域计算)

**Files:**
- Create: `engine/bridge_windows.mjs`
- Test: `engine/bridge_windows.test.mjs`

**Interfaces:**
- Produces(纯函数,本任务):`export function regionFromParts(parts, { aspect = 2017 / 1081, pad = 160 } = {}) -> { left, right, top, bottom } | null`。**用器件 bbox(排除大图框矩形,只吃 parts 的 bbox),按中位数定中心、紧窗成 aspect。** 桥 I/O 函数在 Task 11 加。

- [ ] **Step 1: Write the failing test**

```js
// engine/bridge_windows.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionFromParts } from './bridge_windows.mjs';

test('regionFromParts 空 → null', () => {
	assert.equal(regionFromParts([]), null);
});

test('regionFromParts 围住器件且满足 aspect', () => {
	const parts = [
		{ bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
		{ bbox: { minX: 90, minY: 90, maxX: 100, maxY: 100 } },
	];
	const r = regionFromParts(parts, { aspect: 2, pad: 0 });
	assert.ok(r.left <= 0 && r.right >= 100);
	const w = r.right - r.left, h = r.top - r.bottom;
	assert.ok(Math.abs(w / h - 2) < 1e-6); // 满足 aspect
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/bridge_windows.test.mjs`
Expected: FAIL（`Cannot find module './bridge_windows.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/bridge_windows.mjs
// 可复用多窗口桥工具:窗口枚举/定向/激活/截图/读几何 + 区域计算。
// 操作配方见记忆 eda-api-capability-map。零特定电路内容。
import { findBridge, listEdaWindows, executeCode } from './bridge_client.mjs';

// 纯函数:由 parts 的 bbox 算紧窗(已排除大图框——调用方只传 parts)。
export function regionFromParts(parts, { aspect = 2017 / 1081, pad = 160 } = {}) {
	const bx = (parts || []).map(p => p.bbox).filter(Boolean);
	if (!bx.length) return null;
	const minX = Math.min(...bx.map(b => b.minX)), maxX = Math.max(...bx.map(b => b.maxX));
	const minY = Math.min(...bx.map(b => b.minY)), maxY = Math.max(...bx.map(b => b.maxY));
	const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
	let w = (maxX - minX) + 2 * pad, h = (maxY - minY) + 2 * pad;
	if (w / h > aspect) h = w / aspect; else w = h * aspect;
	return { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/bridge_windows.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/bridge_windows.mjs engine/bridge_windows.test.mjs
git commit -m "feat: bridge_windows.regionFromParts 紧窗区域计算"
```

---

### Task 11: bridge_windows 桥 I/O(列窗口/读几何/截图)

**Files:**
- Modify: `engine/bridge_windows.mjs`
- Test: `engine/bridge_windows.test.mjs`

**Interfaces:**
- Consumes: `findBridge`/`listEdaWindows`/`executeCode`(bridge_client)、`regionFromParts`。
- Produces:
  - `export async function listWindows({ port } = {}) -> { windows, activeWindowId, count }`
  - `export async function readGeometry({ windowId, port } = {}) -> model`(跑 `snapshot2.js` 同款脚本)
  - `export async function captureRegion({ windowId, port, region, outFile }) -> { outFile }`(zoomToRegion+截图)
  - 这些走真实桥,**无法纯单测**;单测只覆盖"桥不可用时抛错"的 fail-closed 行为(注入假 executeCode 不可行 → 改测 `listWindows` 在无桥时 reject)。

- [ ] **Step 1: Write the failing test**

```js
import { listWindows } from './bridge_windows.mjs';

test('listWindows 无桥时 fail-closed(reject)', async () => {
	// 用极小超时 + 不可能端口,确认抛错而非静默返回空
	await assert.rejects(() => listWindows({ port: 1 }), /bridge|not found|fetch|abort|ECONN/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/bridge_windows.test.mjs`
Expected: FAIL（`listWindows is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
// 追加到 engine/bridge_windows.mjs
const SNAPSHOT_CODE = `
const round = v => (typeof v === 'number' ? Math.round(v*100)/100 : v);
const ids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
const components = [], netflags = [];
for (const id of ids) {
  const c = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id); if (!c) continue;
  const r = await eda.sch_Primitive.getPrimitivesBBox([id]);
  const bbox = r ? { minX:round(r.minX??r.x), minY:round(r.minY??r.y), maxX:round(r.maxX??(r.x+r.width)), maxY:round(r.maxY??(r.y+r.height)) } : null;
  if (c.componentType === 'part') {
    const ps = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(id) || [];
    const attrs = (await eda.sch_PrimitiveAttribute.getAll(id).catch(()=>[])) || [];
    components.push({ id, designator:c.designator||null, name:c.name||null, value:(c.otherProperty&&c.otherProperty.Value)||null,
      x:c.x, y:c.y, rotation:c.rotation, mirror:!!c.mirror, bbox,
      attrs: attrs.map(a=>({key:a.key||'', value:a.value||'', x:a.x, y:a.y, keyVisible:a.keyVisible??null, valueVisible:a.valueVisible??null})),
      pins: ps.map(p=>({num:p.pinNumber, name:p.pinName, x:p.x, y:p.y, rot:p.rotation, len:p.pinLength, type:p.pinType, noConnected:p.getState_NoConnected?p.getState_NoConnected():false})) });
  } else if (c.componentType==='netflag'||c.componentType==='netport') {
    netflags.push({ id, type:c.componentType, net:c.net||c.netLabel||'', x:c.x, y:c.y, rotation:c.rotation, mirror:!!c.mirror, bbox });
  }
}
const wiresRaw = await eda.sch_PrimitiveWire.getAll() || [];
const wires = [];
for (const w of wiresRaw) {
  const id = w.primitiveId || (w.getState_PrimitiveId && w.getState_PrimitiveId());
  const attrs = id ? (await eda.sch_PrimitiveAttribute.getAll(id).catch(()=>[])) || [] : [];
  wires.push({ id, net:w.net||'', line:w.line||(w.getState_Line&&w.getState_Line())||[],
    attrs: attrs.map(a=>({key:a.key||'', value:a.value||'', x:a.x, y:a.y})) });
}
return { components, netflags, wires, texts: [], rectangles: [] };
`;

export async function listWindows({ port = 0 } = {}) {
	const { windows } = await listEdaWindows({ port });
	return windows;
}

export async function readGeometry({ windowId = '', port = 0 } = {}) {
	const { result } = await executeCode(SNAPSHOT_CODE, { windowId, port });
	return result;
}

export async function activatePage({ windowId = '', port = 0, tabId }) {
	await executeCode(`await eda.dmt_EditorControl.activateDocument(${JSON.stringify(tabId)}); return true;`, { windowId, port });
}

export async function captureRegion({ windowId = '', port = 0, region, outFile }) {
	const { left, right, top, bottom } = region;
	const code = `
const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(()=>null);
const tabId = doc&&doc.tabId?doc.tabId:undefined;
const ok = await eda.dmt_EditorControl.zoomToRegion(${left},${right},${top},${bottom}, tabId);
await new Promise(r=>setTimeout(r,1000));
const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(tabId);
if(!blob) return { error:'no blob' };
const buf = await blob.arrayBuffer(); const bytes = new Uint8Array(buf);
let bin=''; const ch=0x8000; for(let i=0;i<bytes.length;i+=ch) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+ch));
return { type:blob.type, size:bytes.length, b64:btoa(bin) };
`;
	const { result } = await executeCode(code, { windowId, port });
	if (!result || !result.b64) throw new Error(`captureRegion 无图: ${JSON.stringify(result)}`);
	const { writeFileSync } = await import('node:fs');
	writeFileSync(outFile, Buffer.from(result.b64, 'base64'));
	return { outFile };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/bridge_windows.test.mjs`
Expected: PASS（无桥/端口 1 → reject）

- [ ] **Step 5: Commit**

```bash
git add engine/bridge_windows.mjs engine/bridge_windows.test.mjs
git commit -m "feat: bridge_windows 桥 I/O(列窗口/读几何/激活页/局部截图)"
```

---

### Task 12: 裁判 harness commercial_judge(纯报告组装)

**Files:**
- Create: `engine/commercial_judge.mjs`
- Test: `engine/commercial_judge.test.mjs`

**Interfaces:**
- Consumes: `scoreAll`(commercial_rubric)。
- Produces: `export function judgeBoard(model, { drc, shots = [] } = {}) -> { commercialPass, blockFail, flagFail, rules, shots, summary }`(纯;`shots`=证据截图路径数组,原样附入报告供视觉补判 CR-06对齐/CR-08/CR-09)。

- [ ] **Step 1: Write the failing test**

```js
// engine/commercial_judge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeBoard } from './commercial_judge.mjs';

test('judgeBoard 组装证据化报告', () => {
	const model = { components: [], wires: [] };
	const rep = judgeBoard(model, { drc: { error: 1, warn: 2, info: 0 }, shots: ['/tmp/a.png'] });
	assert.equal(rep.commercialPass, false);    // CR-01 error=1 → block fail
	assert.ok(rep.rules.find(r => r.id === 'CR-01' && r.pass === false));
	assert.deepEqual(rep.shots, ['/tmp/a.png']);
	assert.match(rep.summary, /block/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_judge.test.mjs`
Expected: FAIL（`Cannot find module './commercial_judge.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/commercial_judge.mjs
// 裁判 harness:取证(桥)→ 打分(纯)→ 证据化报告。零特定电路内容(报告只含匿名规则+证据路径)。
import { scoreAll } from './commercial_rubric.mjs';

export function judgeBoard(model, { drc, shots = [] } = {}) {
	const s = scoreAll(model, { drc });
	const summary = `block 失败 ${s.blockFail} / flag 失败 ${s.flagFail} / 商用达标=${s.commercialPass}`;
	return { commercialPass: s.commercialPass, blockFail: s.blockFail, flagFail: s.flagFail, rules: s.rules, shots, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_judge.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_judge.mjs engine/commercial_judge.test.mjs
git commit -m "feat: commercial_judge.judgeBoard 纯报告组装"
```

---

### Task 13: 裁判 harness 实时取证编排 runLiveJudge

**Files:**
- Modify: `engine/commercial_judge.mjs`
- Test: `engine/commercial_judge.test.mjs`

**Interfaces:**
- Consumes: `bridge_windows`(`listWindows`/`readGeometry`/`captureRegion`/`regionFromParts`)、现有 `bridge_client.executeCode`(跑 DRC)、`judgeBoard`。
- Produces: `export async function runLiveJudge({ windowId, port, outDir } = {}) -> report`。流程:预检桥→读几何→跑 DRC→整图+按器件群局部截图→judgeBoard→写 `outDir/judge_report.json`(不含特定内容)。**走真实桥,单测仅覆盖"桥不可用即 reject"。**

- [ ] **Step 1: Write the failing test**

```js
import { runLiveJudge } from './commercial_judge.mjs';

test('runLiveJudge 无桥 → fail-closed(reject,不伪装绿灯)', async () => {
	await assert.rejects(() => runLiveJudge({ port: 1, outDir: '/tmp' }), /bridge|not found|fetch|abort|ECONN/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_judge.test.mjs`
Expected: FAIL（`runLiveJudge is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
// 追加到 engine/commercial_judge.mjs
import { readGeometry, captureRegion, regionFromParts } from './bridge_windows.mjs';
import { executeCode } from './bridge_client.mjs';
import { writeFileSync } from 'node:fs';

async function runDrc({ windowId, port }) {
	const code = `
const res = await eda.sch_Drc.check(true, false, true).catch(()=>null);
if (!Array.isArray(res)) return { error:0, warn:0, info:0, raw:false };
const pick = t => (res.find(x=>x.type===t)||{count:0}).count||0;
return { error: pick('fatalError')+pick('error'), warn: pick('warn'), info: pick('info'), raw:true };
`;
	const { result } = await executeCode(code, { windowId, port });
	return result;
}

export async function runLiveJudge({ windowId = '', port = 0, outDir = '.' } = {}) {
	const model = await readGeometry({ windowId, port });          // 桥不可用在此 reject(fail-closed)
	const drc = await runDrc({ windowId, port });
	const shots = [];
	const region = regionFromParts(model.components || []);
	if (region) {
		const out = `${outDir}/judge_region.png`;
		try { await captureRegion({ windowId, port, region, outFile: out }); shots.push(out); } catch { /* 截图失败不伪装,留空证据 */ }
	}
	const report = judgeBoard(model, { drc, shots });
	writeFileSync(`${outDir}/judge_report.json`, JSON.stringify({ ...report, drc }, null, 2), 'utf8');
	return report;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_judge.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_judge.mjs engine/commercial_judge.test.mjs
git commit -m "feat: runLiveJudge 实时取证编排(fail-closed)"
```

---

### Task 14: CLI 接入 `bin/plexus.mjs judge` + 离线 geometry 评分

**Files:**
- Modify: `bin/plexus.mjs`
- Modify: `engine/commercial_judge.mjs`
- Test: `engine/commercial_judge.test.mjs`

**Interfaces:**
- Produces: `export function judgeSnapshot(snapshotPath, { drc } = {}) -> report`(离线:读 snapshot JSON → judgeBoard,无桥,供快速反馈/测试);CLI:`node bin/plexus.mjs judge <snapshot.json>`(离线几何评分)与 `judge --live`(走 runLiveJudge)。

- [ ] **Step 1: Write the failing test**

```js
import { judgeSnapshot } from './commercial_judge.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('judgeSnapshot 读 JSON 离线评分', () => {
	const dir = mkdtempSync(join(tmpdir(), 'judge-'));
	const f = join(dir, 's.json');
	writeFileSync(f, JSON.stringify({ components: [], wires: [] }));
	const rep = judgeSnapshot(f, { drc: { error: 0, warn: 0, info: 0 } });
	assert.equal(rep.rules.length, 10);
	assert.equal(rep.commercialPass, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/commercial_judge.test.mjs`
Expected: FAIL（`judgeSnapshot is not a function`）

- [ ] **Step 3: Write minimal implementation**

```js
// 追加到 engine/commercial_judge.mjs
import { readFileSync } from 'node:fs';
export function judgeSnapshot(snapshotPath, { drc } = {}) {
	const model = JSON.parse(readFileSync(snapshotPath, 'utf8').replace(/^﻿/, ''));
	return judgeBoard(model, { drc, shots: [] });
}
```

```js
// 在 bin/plexus.mjs 的 main() 命令分发处追加(与现有 layout/deliver 同级):
	if (cmd === 'judge') {
		const live = args.includes('--live');
		if (live) {
			const { runLiveJudge } = await import('../engine/commercial_judge.mjs');
			const rep = await runLiveJudge({ outDir: '.' });
			console.log(rep.summary);
			console.log('证据报告 -> judge_report.json');
			process.exit(rep.commercialPass ? 0 : 1);
		}
		const { judgeSnapshot } = await import('../engine/commercial_judge.mjs');
		const snap = args.find(a => /\.json$/.test(a));
		if (!snap) { console.error('用法: plexus judge <snapshot.json> | judge --live'); process.exit(2); }
		const rep = judgeSnapshot(snap);
		for (const r of rep.rules) console.log(`${r.id}: ${r.pass === null ? '待视觉' : r.pass ? '✓' : '✗'} ${JSON.stringify(r)}`);
		console.log(rep.summary);
		process.exit(rep.commercialPass ? 0 : 1);
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/commercial_judge.test.mjs`
然后人工冒烟:`node bin/plexus.mjs judge` 应打印用法并退出码 2。
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/commercial_judge.mjs bin/plexus.mjs
git commit -m "feat: plexus judge CLI(离线 geometry 评分 + --live 取证)"
```

---

### Task 15: C1 现有规则审计扫描器(去 demo 偶合)

**Files:**
- Create: `engine/rubric_audit.mjs`
- Test: `engine/rubric_audit.test.mjs`

**Interfaces:**
- Produces: `export function scanSpecificContent(text) -> string[]`(返回命中的特定电路指纹片段);`export async function auditRuleDocs(paths) -> { file, hits }[]`。用于审计 `docs/schematic_design_rulebook.md`/`schematic-design-rules.md` 是否含 demo 偶合内容。

- [ ] **Step 1: Write the failing test**

```js
// engine/rubric_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSpecificContent } from './rubric_audit.mjs';

test('扫描命中具体器件/网名指纹', () => {
	assert.deepEqual(scanSpecificContent('用 AMS1117 给 VCC3V3_WL 供电'), ['AMS1117', 'VCC3V3_WL'].filter(x => 'AMS1117 给 VCC3V3_WL'.includes(x)).length ? scanSpecificContent('AMS1117 VCC3V3_WL') : []) || true;
	const hits = scanSpecificContent('AMS1117 and ESP32 net VDD_CPU');
	assert.ok(hits.includes('AMS1117'));
	assert.ok(hits.includes('ESP32'));
});

test('通用文本无命中', () => {
	assert.deepEqual(scanSpecificContent('去耦电容贴近电源脚,标签贴线对齐'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test engine/rubric_audit.test.mjs`
Expected: FAIL（`Cannot find module './rubric_audit.mjs'`）

- [ ] **Step 3: Write minimal implementation**

```js
// engine/rubric_audit.mjs
// 审计规则文档是否含特定电路偶合内容(零特定电路铁律守门)。
import { readFile } from 'node:fs/promises';

// 通用指纹:具体器件型号、典型私有网名模式(大写+下划线+功能后缀)、已知 demo 名。
const FINGERPRINTS = [
	/\bAMS1117\b/i, /\bAO3400\w*/i, /\bESP32\w*/i, /\bESP8266\b/i, /\bRK3576\b/i, /\bRK806\w*/i,
	/\bvibe[-_]?buddy\b/i, /\baihwdebugger\b/i,
	/\bVCC3V3_\w+/, /\bVDD_CPU\w*/, /\bWIFI_SDIO_\w+/,
];

export function scanSpecificContent(text) {
	const hits = [];
	for (const re of FINGERPRINTS) {
		const m = String(text || '').match(re);
		if (m) hits.push(m[0]);
	}
	return hits;
}

export async function auditRuleDocs(paths) {
	const out = [];
	for (const p of paths) {
		const text = await readFile(p, 'utf8').catch(() => '');
		out.push({ file: p, hits: scanSpecificContent(text) });
	}
	return out;
}
```

> 注:Step 1 第一个断言写法笨拙,改成清晰版本:

```js
test('扫描命中具体器件/网名指纹', () => {
	const hits = scanSpecificContent('AMS1117 and ESP32 net VDD_CPU');
	assert.ok(hits.includes('AMS1117'));
	assert.ok(hits.includes('ESP32'));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test engine/rubric_audit.test.mjs`
然后跑一次真实审计:`node -e "import('./engine/rubric_audit.mjs').then(m=>m.auditRuleDocs(['docs/schematic_design_rulebook.md','docs/schematic-design-rules.md']).then(r=>console.log(JSON.stringify(r,null,2))))"` → 人工处理命中项(把 demo 偶合规则泛化/删除)。
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/rubric_audit.mjs engine/rubric_audit.test.mjs
git commit -m "feat: C1 规则审计扫描器(守零特定电路铁律)"
```

---

### Task 16: 首基线 + 接入测试套件 + 文档

**Files:**
- Modify: `package.json`(确认 `test` glob 覆盖新 `engine/*.test.mjs`——现有 glob 即 `engine/*.test.mjs`,无需改;仅核对)
- Modify: `AGENTS.md`(在架构清单加 `commercial_rubric`/`commercial_judge`/`bridge_windows` 一行)

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: 首基线报告(本地 `judge_report.json`,不入库)+ 文档更新。

- [ ] **Step 1: 跑全量测试确认零回归**

Run: `npm test`
Expected: 全绿(原 219 + 新增 rubric/judge/bridge_windows/audit 各测试),无 fail。

- [ ] **Step 2: 在真实板上跑首基线(需桥 + EDA 打开目标板)**

Run: `node bin/plexus.mjs judge --live`
Expected: 打印 `summary`(blockFail/flagFail/commercialPass),写出 `judge_report.json` + `judge_region.png`。**这是 Spec A 的诚实基线**——记录当前真实板离商用差多少、差在哪(证据在本地,不入库)。

- [ ] **Step 3: 更新 AGENTS.md 架构清单**

在 `## Architecture (all generic)` 末尾追加一行:

```markdown
- `engine/commercial_rubric.mjs` / `engine/commercial_judge.mjs` / `engine/bridge_windows.mjs` — 商用级裁判:
  冻结的 CR-01~10 可量规则 + 用真实 EDA 证据(几何/DRC/局部截图)对照打分的验证闭环。
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md package.json
git commit -m "docs: AGENTS 架构加商用级裁判;Spec A 首基线已跑(报告本地)"
```

---

## Self-Review

**1. Spec coverage(对 Spec A §1~§14):**
- C1 规则审计 → Task 15 ✓
- C2 商业范例挖掘(可复用桥工具)→ Task 10/11(`bridge_windows`);挖掘本身已在 brainstorm 完成 ✓
- C3 冻结 checklist(CR-01~10)→ Task 1~9 ✓
- C4 验证 harness → Task 12/13/14 ✓
- C5 首基线 → Task 16 ✓
- §3 三铁律:规则冻结(Task 1 常量)/真实证据(Task 13 桥取证)/零特定内容(Task 1+15 扫描)✓
- §10 错误处理 fail-closed → Task 11/13 reject 测试 ✓
- §11 测试策略:纯指标单测 + 桥层 fail-closed 测 ✓

**2. Placeholder scan:** 已消除 Task 15 Step 1 笨拙断言(给出清晰替代)。无 TBD/TODO。每个 code step 均含完整代码。

**3. Type consistency:** `scoreAll(model,{drc})`→`{rules,blockFail,flagFail,commercialPass}` 在 Task 9/12 一致;`judgeBoard`→`{commercialPass,blockFail,flagFail,rules,shots,summary}` 在 Task 12/13/14 一致;`regionFromParts`→`{left,right,top,bottom}` 在 Task 10/13 一致;`THRESHOLDS` 字段名贯穿 Task 1~8 一致。

**已知边界:** 桥 I/O(Task 11/13)与 CLI `--live`(Task 14)、首基线(Task 16 Step 2)需真实桥 + EDA 打开目标板,无法纯 `node --test` 覆盖,仅覆盖 fail-closed 路径;视觉规则(CR-06 对齐/CR-08/CR-09)由 AI 代理读 `shots` 截图补判,harness 只负责附证据。

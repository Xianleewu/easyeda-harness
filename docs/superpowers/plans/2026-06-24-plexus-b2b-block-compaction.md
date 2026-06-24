# Plexus B2b 增量① 刚性块紧排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `generateLayout` 增加一个纯几何"重力压实"后处理 `compactBlocks`,在不改任何块内几何、不改任何电气连接的前提下消除块间空洞、缩小整板。

**Architecture:** 保留现有连接驱动摆放 `connPlace` 不动;新增 `compactBlocks(pos, subs, opts)`(同文件 `engine/conn_place.mjs`),把 connPlace 输出的块位向原点压实、吸格到 10、零叠压;`generateLayout` 在 connPlace 后接一行调用(`opts.compact !== false` 默认开)。块是刚性单元整体平移 + 跨模块连接靠网名标签 → 连接绝对不变。

**Tech Stack:** Node.js ESM、`node:test` + `node:assert/strict`(项目现有测试栈)、纯 JS 几何。

## Global Constraints

- 通用、零特定电路内容:任何代码/测试/文档**绝不含** designator、器件型号、网名等特定电路字面量;测试夹具用通用名(U1/R1/Q1…)。
- 测试**不得依赖** `live.json`(含特定内容);集成测试用合成板。
- 不做向后兼容;Linux 风格;`compactBlocks` 为纯函数,不就地改入参 `pos`(返回新 Map)。
- 闭环铁律:本增量最终必须 deliver+reload 投真实 EDA,用数据(geomQC / `getNetlistFile` 权威网表)验证,视觉以用户前台 EDA 为准(桥截图不可靠)。
- 裁判分硬门(任一不过=不合格,改引擎不放水)/报告目标(测量报值,不达不自动判失败)——见 spec。

---

### Task 1: `compactBlocks` 纯函数 + 单测

**Files:**
- Modify: `engine/conn_place.mjs`(在 `connPlace` 后追加 `compactBlocks` 导出)
- Test: `engine/conn_place.test.mjs`(追加 3 个用例)

**Interfaces:**
- Consumes: `pos: Map<id, {X:number, Y:number, mir:boolean}>`(connPlace 返回);`subs: Array<{id:string, w:number, h:number}>`(块宽高,connPlace 同源入参,可含额外字段如 pins,忽略)。
- Produces: `compactBlocks(pos, subs, opts={pad?:number, base?:number, maxIters?:number}) -> Map<id,{X,Y,mir}>`,新 Map;X/Y 向 (base,base) 压实并吸格到 10 的倍数;`mir` 原样透传;块数不变;任意两块 AABB 不重叠。

- [ ] **Step 1: 写失败测试**

在 `engine/conn_place.test.mjs` 末尾追加(文件顶部已 `import { connPlace } from './conn_place.mjs';`,改成 `import { connPlace, compactBlocks } from './conn_place.mjs';`):

```js
test('compactBlocks: 消空洞 → 整体 bbox 缩小且两块不重叠', () => {
	const subs = [{ id: 'A', w: 100, h: 100 }, { id: 'B', w: 100, h: 100 }];
	const pos = new Map([
		['A', { X: 60, Y: 60, mir: false }],
		['B', { X: 500, Y: 500, mir: false }],   // 远,留大洞
	]);
	const area = m => {
		let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
		for (const [id, p] of m) { const s = subs.find(z => z.id === id); x0 = Math.min(x0, p.X); y0 = Math.min(y0, p.Y); x1 = Math.max(x1, p.X + s.w); y1 = Math.max(y1, p.Y + s.h); }
		return (x1 - x0) * (y1 - y0);
	};
	const out = compactBlocks(pos, subs, { pad: 40, base: 60 });
	assert.ok(area(out) < area(pos), `压实后 bbox 应更小(${area(out)} < ${area(pos)})`);
	const a = out.get('A'), b = out.get('B');
	const overlap = a.X < b.X + 100 && b.X < a.X + 100 && a.Y < b.Y + 100 && b.Y < a.Y + 100;
	assert.ok(!overlap, '两块不应重叠');
});

test('compactBlocks: mir 透传、块数不变、确定性、不改原 pos', () => {
	const subs = [{ id: 'A', w: 80, h: 80 }, { id: 'B', w: 80, h: 80 }, { id: 'C', w: 80, h: 80 }];
	const pos = new Map([
		['A', { X: 60, Y: 60, mir: true }],
		['B', { X: 400, Y: 60, mir: false }],
		['C', { X: 60, Y: 400, mir: true }],
	]);
	const o1 = compactBlocks(pos, subs, { pad: 40, base: 60 });
	const o2 = compactBlocks(pos, subs, { pad: 40, base: 60 });
	assert.equal(o1.size, 3, '块数不变');
	assert.equal(o1.get('A').mir, true, 'A.mir 透传');
	assert.equal(o1.get('C').mir, true, 'C.mir 透传');
	for (const id of ['A', 'B', 'C']) assert.deepEqual(o1.get(id), o2.get(id), `${id} 确定性`);
	assert.equal(pos.get('B').X, 400, '不就地改原 pos(immutable)');
});

test('compactBlocks: 末位坐标吸格到 10 的倍数', () => {
	const subs = [{ id: 'A', w: 73, h: 51 }, { id: 'B', w: 67, h: 49 }];
	const pos = new Map([['A', { X: 60, Y: 60, mir: false }], ['B', { X: 300, Y: 300, mir: false }]]);
	const out = compactBlocks(pos, subs, { pad: 40, base: 60 });
	for (const [, p] of out) { assert.equal(p.X % 10, 0, 'X 吸格'); assert.equal(p.Y % 10, 0, 'Y 吸格'); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/conn_place.test.mjs`
Expected: FAIL —— `compactBlocks is not a function`(或 import 报错)。

- [ ] **Step 3: 实现 `compactBlocks`**

在 `engine/conn_place.mjs` 文件末尾(`connPlace` 函数之后)追加:

```js
// 纯几何重力压实(通用):把 connPlace 输出的块位向原点 (BASE,BASE) 压实,消块间空洞。
// 块刚性整体平移、跨模块连接靠网名标签 → 不改任何电气连接。返回新 Map,不就地改 pos。
export function compactBlocks(pos, subs, opts = {}) {
	const PAD = opts.pad ?? 40, BASE = opts.base ?? 60, MAX_ITERS = opts.maxIters ?? 8;
	const sub = new Map(subs.map(s => [s.id, s]));
	const wOf = id => sub.get(id).w, hOf = id => sub.get(id).h;
	const P = new Map([...pos].map(([id, p]) => [id, { X: p.X, Y: p.Y, mir: p.mir }]));
	// 在 (X,Y) 放块 id 是否与他块叠压(带 PAD)。
	const collides = (id, X, Y) => {
		const w = wOf(id), h = hOf(id);
		for (const [oid, q] of P) {
			if (oid === id) continue;
			if (X < q.X + wOf(oid) + PAD && X + w + PAD > q.X &&
				Y < q.Y + hOf(oid) + PAD && Y + h + PAD > q.Y) return true;
		}
		return false;
	};
	// 沿 X 向左滑到最小可行位(≥BASE,≤当前 X);候选=BASE、各 Y 重叠块的右边沿+PAD、当前位。
	const slideX = (id, Y) => {
		const cur = P.get(id).X, h = hOf(id);
		const stops = [BASE, cur];
		for (const [oid, q] of P) {
			if (oid === id) continue;
			if (Y < q.Y + hOf(oid) + PAD && Y + h + PAD > q.Y) {
				const edge = q.X + wOf(oid) + PAD;
				if (edge <= cur) stops.push(edge);
			}
		}
		stops.sort((a, b) => a - b);
		for (const x of stops) if (x <= cur && !collides(id, x, Y)) return x;
		return cur;
	};
	// 沿 Y 向上滑到最小可行位(对称)。
	const slideY = (id, X) => {
		const cur = P.get(id).Y, w = wOf(id);
		const stops = [BASE, cur];
		for (const [oid, q] of P) {
			if (oid === id) continue;
			if (X < q.X + wOf(oid) + PAD && X + w + PAD > q.X) {
				const edge = q.Y + hOf(oid) + PAD;
				if (edge <= cur) stops.push(edge);
			}
		}
		stops.sort((a, b) => a - b);
		for (const y of stops) if (y <= cur && !collides(id, X, y)) return y;
		return cur;
	};
	for (let it = 0; it < MAX_ITERS; it++) {
		let moved = false;
		// 离原点近者先压(给后者让空间);距离平局按 id 字典序 → 确定性。
		const order = [...P.keys()].sort((a, b) => {
			const pa = P.get(a), pb = P.get(b);
			const da = (pa.X - BASE) + (pa.Y - BASE), db = (pb.X - BASE) + (pb.Y - BASE);
			return da - db || (a < b ? -1 : a > b ? 1 : 0);
		});
		for (const id of order) {
			const p = P.get(id);
			const nx = slideX(id, p.Y);
			if (nx < p.X) { p.X = nx; moved = true; }
			const ny = slideY(id, p.X);
			if (ny < p.Y) { p.Y = ny; moved = true; }
		}
		if (!moved) break;
	}
	for (const [, p] of P) { p.X = Math.round(p.X / 10) * 10; p.Y = Math.round(p.Y / 10) * 10; }
	return P;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test engine/conn_place.test.mjs`
Expected: PASS —— 全部用例(原 4 + 新 3 = 7)通过。

- [ ] **Step 5: 提交**

```bash
git add engine/conn_place.mjs engine/conn_place.test.mjs
git commit -m "feat: compactBlocks 重力压实(块刚性向原点压实消空洞,吸格10零叠压,纯函数确定性)"
```

---

### Task 2: 接入 `generateLayout`(connPlace 后压实) + 集成测试

**Files:**
- Modify: `engine/cluster_generate.mjs:18`(import)、`:495-496`(connPlace 后接 compactBlocks)
- Test: `engine/cluster_generate.test.mjs`(追加 1 个 compact on/off 对比用例)

**Interfaces:**
- Consumes: `compactBlocks(pos, subs, opts)`(Task 1)。
- Produces: `generateLayout(snap, opts)` 新增 `opts.compact`(默认 `true`;`false` 关压实做对比基线);其余签名/返回不变。

- [ ] **Step 1: 写失败测试**

在 `engine/cluster_generate.test.mjs` 末尾追加(顶部已 import `generateLayout`、`geomQC`、`labelQC`):

```js
// B2b 增量①:刚性块紧排 —— compact 默认压实使整板更紧,且几何/标签零回归。合成多簇板(通用名)。
test('generateLayout: compact 压实 → 整板 bbox 缩小且 geom/label 零回归', async () => {
	const ic = (des, x, y, pins) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 40, minY: y - pins.length * 10, maxX: x + 40, maxY: y + pins.length * 10 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 40 : x + 40, y: y - pins.length * 10 + i * 20 + 10, side: p.s === 'L' ? 'left' : 'right' })) });
	const two = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	const Q = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 20, maxX: x + 15, maxY: y + 20 }, pins: [{ num: '1', name: 'B', x: x - 15, y, side: 'left' }, { num: '2', name: 'C', x: x + 5, y: y - 20, side: 'top' }, { num: '3', name: 'E', x: x + 5, y: y + 20, side: 'bottom' }] });
	const comps = [
		ic('U1', 400, 500, [{ n: 'VDD', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'R' }, { n: 'GPIO_LED', s: 'R' }, { n: 'ADC_IN', s: 'R' }]),
		ic('U3', 900, 600, [{ n: 'VDD', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'L' }]),
		ic('U4', 400, 900, [{ n: 'IN_NEG', s: 'L' }, { n: 'IN_POS', s: 'L' }, { n: 'VDD', s: 'L' }, { n: 'OUT', s: 'R' }]),
		Q('Q1', 700, 900), two('R1', 550, 520), two('R3', 550, 560), two('R_IN', 250, 860), two('R_FB', 550, 860), two('LED1', 750, 800), two('C1', 150, 420), two('C4', 150, 860),
	];
	const pin = (d, n) => { const c = comps.find(x => x.designator === d); const p = c.pins.find(pp => pp.name === n || pp.num === String(n)); return [p.x, p.y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const wires = [
		W('VDD', pin('U1', 'VDD'), pin('C1', 1)), W('VDD', pin('U3', 'VDD'), pin('U1', 'VDD')), W('VDD', pin('U4', 'VDD'), pin('C4', 1)),
		W('SCL', pin('U1', 'SCL'), pin('U3', 'SCL')), W('SCL', pin('U1', 'SCL'), pin('R1', 1)), W('VDD', pin('R1', 2), pin('U1', 'VDD')),
		W('GPIO_LED', pin('U1', 'GPIO_LED'), pin('R3', 1)), W('Q_B', pin('R3', 2), pin('Q1', 'B')), W('Q_COL', pin('Q1', 'C'), pin('LED1', 1)),
		W('ADC_IN', pin('U1', 'ADC_IN'), pin('U4', 'OUT')), W('IN_NEG', pin('U4', 'IN_NEG'), pin('R_IN', 2)), W('OUT', pin('U4', 'OUT'), pin('R_FB', 1)), W('IN_NEG', pin('R_FB', 2), pin('U4', 'IN_NEG')),
	];
	const netflags = [['U1', 'GND'], ['U3', 'GND'], ['U4', 'IN_POS'], ['Q1', 'E'], ['C1', 2], ['C4', 2]].map(([d, p]) => ({ net: 'GND', symbol: 'Ground-GND', x: pin(d, p)[0], y: pin(d, p)[1] }));
	netflags.push({ net: 'VCC', symbol: 'Power', x: pin('LED1', 2)[0], y: pin('LED1', 2)[1] });
	const snap = { components: comps, wires, netflags };
	const bboxArea = m => {
		let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
		for (const c of m.components) { const b = c.bbox; if (!b) continue; x0 = Math.min(x0, b.minX); y0 = Math.min(y0, b.minY); x1 = Math.max(x1, b.maxX); y1 = Math.max(y1, b.maxY); }
		return (x1 - x0) * (y1 - y0);
	};
	const hard = m => labelQC(m).filter(f => f.severity === 'hard').length;
	const geoHard = m => { const g = geomQC(m); return g.overlaps.length + g.crossings + g.wireThruComp.length + g.wireThruPin.length; };
	const base = await generateLayout(structuredClone(snap), { scale: false, deconflict: true, compact: false });
	const comp = await generateLayout(structuredClone(snap), { scale: false, deconflict: true, compact: true });
	assert.equal(comp.stats.placements, base.stats.placements, '压实不掉件');
	assert.ok(bboxArea(comp.model) < bboxArea(base.model), `压实后整板更小(${Math.round(bboxArea(comp.model))} < ${Math.round(bboxArea(base.model))})`);
	assert.ok(geoHard(comp.model) <= geoHard(base.model), `几何零回归(${geoHard(comp.model)} ≤ ${geoHard(base.model)})`);
	assert.ok(hard(comp.model) <= hard(base.model), `硬标签零回归(${hard(comp.model)} ≤ ${hard(base.model)})`);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --test-name-pattern="compact 压实" engine/cluster_generate.test.mjs`
Expected: FAIL —— `compact:true` 与 `compact:false` 当前行为相同(compactBlocks 未接入),`bboxArea(comp) < bboxArea(base)` 不成立。

- [ ] **Step 3: 接入 compactBlocks**

修改 `engine/cluster_generate.mjs:18` 的 import:

```js
import { connPlace, compactBlocks } from './conn_place.mjs';
```

修改 `engine/cluster_generate.mjs:495-496`,把:

```js
		const cp = connPlace(cpSubs, logical.nets, { pad: PAD, base: BASE, aspect: opts.aspect ?? 1.4, aspectW: opts.aspectW ?? 1.0 });
		for (const s of subs) { const p = cp.get(s.anchor); posOf.set(s, { x: p.X, y: p.Y }); if (p.mir) mirrorModuleX(s.model, (s.bb.minX + s.bb.maxX) / 2); }
```

改为:

```js
		const cp = connPlace(cpSubs, logical.nets, { pad: PAD, base: BASE, aspect: opts.aspect ?? 1.4, aspectW: opts.aspectW ?? 1.0 });
		// B2b 增量①:连接驱动初位后做纯几何重力压实,消块间空洞(刚性平移→连接不变)。opts.compact:false 关(对比基线)。
		const packed = opts.compact === false ? cp : compactBlocks(cp, cpSubs, { pad: PAD, base: BASE });
		for (const s of subs) { const p = packed.get(s.anchor); posOf.set(s, { x: p.X, y: p.Y }); if (p.mir) mirrorModuleX(s.model, (s.bb.minX + s.bb.maxX) / 2); }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --test-name-pattern="compact 压实" engine/cluster_generate.test.mjs`
Expected: PASS。

- [ ] **Step 5: 全量回归**

Run: `npm test`
Expected: 全绿(原 309 + 新 4 = 313 通过,0 失败)。若任一原用例因压实改变布局而失败,按 systematic-debugging 定位:压实是否引入叠压/破连通(应不会),还是该用例硬编码了旧坐标(则更新断言为不依赖绝对坐标)。

- [ ] **Step 6: 提交**

```bash
git add engine/cluster_generate.mjs engine/cluster_generate.test.mjs
git commit -m "feat: generateLayout 接 compactBlocks 重力压实(opts.compact 默认开,块间空洞消除,几何/标签零回归)"
```

---

### Task 3: 闭环真 EDA 验证(离线全门 → deliver+reload → getNetlistFile → 用户肉眼)

**Files:**
- 临时脚本写 scratchpad(引用 `live.json`=特定内容,**绝不入库**):`/tmp/claude-1000/-home-zettos-workspace-project-easyeda-harness/<session>/scratchpad/b2b_verify.mjs`
- 无源码 commit(本任务交付物=真 EDA 上更紧的板 + 数据证据)。

**Interfaces:**
- Consumes: `generateLayout(snap, {compact})`(Task 2);`deliverGenerated`(已含 save+close+open 重载);bridge `sch_ManufactureData.getNetlistFile()`。

- [ ] **Step 1: 离线全门对比(compact on/off on live.json)**

写 scratchpad 脚本 `b2b_verify.mjs`,读 `live.json`,跑 `generateLayout` 两次(compact false/true),打印 spec 的全部硬门 + 报告目标:
- 整板 bbox 面积(base vs comp,降幅%)。
- 块间空洞占比(用 moduleRegions 框面积合计 / 整板面积)。
- geomQC overlaps/crossings/wireThruComp/wireThruPin(comp ≤ base)。
- labelQC hard(comp == base)。
- 块间最小间距(≥0 不叠压)。
- 逻辑网集合(两次一致)。

Run: `node <scratchpad>/b2b_verify.mjs`
Expected: 硬门全过(面积严格下降、geom/label 不升、零叠压、逻辑网一致);报告目标打印实测值。**任一硬门不过 → 停,回 Task 1/2 改引擎,不放水。**

- [ ] **Step 2: 投递 + 自动重载**

确认桥在线(`curl -s -m 3 http://127.0.0.1:49620/eda-windows`)且用户已开目标原理图。

Run: `node bin/plexus.mjs deliver live.json`
Expected: 输出含 `已 save + 重载文档(强制重绘 → 改动在 EDA 上可见)`;权威网表对账轮次收敛到"真断裂网 0"。

- [ ] **Step 3: 权威网表验连通(投后)**

写/复用 scratchpad 脚本调 `getNetlistFile()` 读投后权威网表,对照投递前快照:每脚 net 归属一致、零新断网。

Expected: 零新断网(连通保全硬门)。

- [ ] **Step 4: 用户前台肉眼确认**

请用户在自己前台 EDA 看重载后的图,确认整板**明显变紧**(块不再是空海孤岛)。桥截图不可靠,不作裁判。

Expected: 用户确认变紧(EDA 可见硬门)。

- [ ] **Step 5: 记录 + 收尾**

把实测数据(面积降幅、空洞%、零回归证据)写入 `.superpowers/sdd/progress.md` 该任务行。无源码 commit。

---

## Self-Review

**1. Spec coverage**(逐条对 spec):
- 架构(保留 connPlace + 新增 compactBlocks 同文件 + generateLayout 接一行)→ Task 1 + Task 2 ✓
- 组件 `compactBlocks(pos, subs, opts) -> pos`(新 Map、mir 透传、≥PAD、吸格10)→ Task 1 ✓
- 数据流(connPlace→compactBlocks→偏移/SNAP/deconflict)→ Task 2 Step 3 ✓
- 算法(重力压实:近原点先、左压再上压、吸格10、确定性、overlap 复用)→ Task 1 Step 3 ✓
- 连通安全(刚性平移 + 网名标签)→ Task 1 论证 + Task 3 getNetlistFile 验 ✓
- 验收硬门(面积↓/geom 零回归/label 不变/零叠压/逻辑网一致/getNetlistFile/EDA 肉眼)→ Task 2 集成测试 + Task 3 ✓
- 报告目标(面积≥20%、空洞≤20%)→ Task 3 Step 1 打印 ✓
- 测试(conn_place 单测 + cluster_generate 集成)→ Task 1/2 ✓
- 非目标(块内瘦身/去标签/全重排)→ 未触碰 ✓

**2. Placeholder scan:** 无 TBD/TODO;所有代码步含完整代码;命令含预期输出。✓

**3. Type consistency:** `compactBlocks(pos, subs, opts)` 签名在 Task 1 定义、Task 2 import+调用一致;返回 `Map<id,{X,Y,mir}>`,Task 2 用 `packed.get(s.anchor).X/.Y/.mir` 一致;`opts.compact` 在 Task 2 定义并在集成测试/Task 3 使用一致。✓

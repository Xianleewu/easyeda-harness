# Plexus design_contract 合成词汇层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个纯模块 `engine/design_contract.mjs`,把 `inferRoles` 的审计模型确定性地编译成通用合成契约 token,并自带 `contractQC` 自洽校验。

**Architecture:** 两个纯函数 `synthesizeContract(roles, logical, opts?)` 与 `contractQC(contract)`,无副作用、不可变、确定性(全程排序、无随机、无 `Date.now`)。数据流:`live.json → extractLogical → inferRoles → synthesizeContract → contractQC`。一个可选瘦 CLI 运行器 `engine/plexus_contract.mjs` 镜像现有 `plexus_audit.mjs`。

**Tech Stack:** Node.js ESM(`.mjs`)、`node:test` + `node:assert/strict`(与现有 `engine/*.test.mjs` 同风格)。无新依赖。

## Global Constraints

- 语言/风格:ESM `.mjs`,纯函数,返回新对象不可变,确定性输出(排序、禁 `Date.now`/`Math.random`)。
- 数据形状(只读,勿改上游):`inferRoles(logical)` → `{ controller, parts:[{ref,kind,role}], modules:[{id, parts:[refs], role, column:'left'|'center'|'right'}] }`;`logical.nets[]` → `{ name, class:'signal'|'power'|'ground', pins:['REF.PIN',…] }`;控制器自成模块 `mctrl`。
- 测试:中文用例名,贴合 `engine/role_infer.test.mjs` 风格;`node --test engine/*.test.mjs` 必须全绿且总数 > 44。
- 零回归:不得改动 `engine/role_infer.mjs`/`schematic_extract.mjs`/`design_pillars.mjs`/`plexus_audit.mjs` 的行为;`npm test`、`workflow:smoke`、`accept` 本地路径不受影响。
- Git:**在功能分支上执行**(当前 `main` 默认分支不直接落任务提交);逐任务提交可在分支进行,但**未经用户要求不 push、不开 PR**。

---

### Task 1: synthesizeContract 核心(列 + 模块区)

**Files:**
- Create: `engine/design_contract.mjs`
- Test: `engine/design_contract.test.mjs`

**Interfaces:**
- Consumes: `inferRoles` from `./role_infer.mjs`(测试用,产出 `roles`)。
- Produces: `synthesizeContract(roles, logical, opts?) -> { schemaVersion:1, grid:{colPitch,rowPitch}, columns:[{id,role,order,modules:[id]}], modules:[{id,role,column,parts:[ref],region:{col,row,wCells,hCells},gap:{left,right,top,bottom}}], labelColumns:[], routingChannels:[], meta:{controller,moduleCount,columnCount} }`(本任务先实现 `columns`/`modules`,`labelColumns`/`routingChannels` 在 Task 2 填充)。

- [ ] **Step 1: 写失败测试** —— 追加到 `engine/design_contract.test.mjs`

```javascript
// design_contract 单测:审计模型 → 通用合成契约(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract, contractQC } from './design_contract.mjs';

const logical = {
	parts: [
		{ ref: 'U1', kind: 'ic', pinCount: 30 },
		{ ref: 'U2', kind: 'ic', pinCount: 5 },
		{ ref: 'J1', kind: 'connector', pinCount: 6 },
		{ ref: 'R1', kind: 'resistor', pinCount: 2 },
		{ ref: 'LED1', kind: 'led', pinCount: 2 },
		{ ref: 'SW1', kind: 'switch', pinCount: 2 },
		{ ref: 'Q1', kind: 'transistor', pinCount: 3 },
	],
	nets: [
		{ name: 'USB_DP', class: 'signal', pins: ['J1.1', 'R1.1'] },
		{ name: 'USB_DP_MCU', class: 'signal', pins: ['R1.2', 'U1.5'] },
		{ name: 'LED_CTRL', class: 'signal', pins: ['U1.6', 'LED1.1'] },
		{ name: 'BTN', class: 'signal', pins: ['U1.7', 'SW1.1'] },
		{ name: 'GATE', class: 'signal', pins: ['U1.8', 'Q1.1'] },
		{ name: 'VCC_3V3', class: 'power', pins: ['U2.3', 'U1.1', 'R1.1'] },
		{ name: 'VIN', class: 'power', pins: ['U2.1', 'J1.2'] },
		{ name: 'GND', class: 'ground', pins: ['U1.2', 'U2.2', 'LED1.2'] },
	],
};

const roles = inferRoles(logical);
const contract = synthesizeContract(roles, logical);

test('列:left/center/right → 有序 input/control/output,控制器在中列', () => {
	const ids = contract.columns.map(c => c.id);
	assert.deepEqual(ids, ['input', 'control', 'output']);
	const order = Object.fromEntries(contract.columns.map(c => [c.id, c.order]));
	assert.ok(order.input < order.control && order.control < order.output);
	assert.equal(contract.meta.controller, 'U1');
	assert.equal(contract.meta.columnCount, 3);
});

test('模块区:每模块有整数列号、正格尺寸、间距预算', () => {
	assert.equal(contract.modules.length, roles.modules.length);
	for (const m of contract.modules) {
		assert.ok(Number.isInteger(m.region.col) && Number.isInteger(m.region.row));
		assert.ok(m.region.wCells > 0 && m.region.hCells > 0);
		assert.deepEqual(Object.keys(m.gap).sort(), ['bottom', 'left', 'right', 'top']);
	}
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/design_contract.test.mjs`
Expected: FAIL —— `Cannot find module './design_contract.mjs'` 或 `synthesizeContract is not a function`。

- [ ] **Step 3: 写最小实现** —— 创建 `engine/design_contract.mjs`(本任务先到 `meta`,`labelColumns`/`routingChannels` 先返回空数组占位,Task 2 实现)

```javascript
// 合成词汇层(纯函数):inferRoles 审计模型 → 通用合成契约 token + 自洽校验。
// 坐标抽象为无量纲网格(列号/行号/格数);绝对坐标留给日后 realizer。

const COLUMN_ORDER = { left: 0, center: 1, right: 2 };
const COLUMN_META = {
	left: { id: 'input', role: 'external input and power' },
	center: { id: 'control', role: 'controller and support' },
	right: { id: 'output', role: 'loads and outputs' },
};
const ROW_GAP = 1;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function sizeOf(role, partCount) {
	const n = Math.max(1, partCount);
	if (role === 'controller') return { wCells: 6, hCells: 4 + Math.ceil(n / 2) };
	if (role === 'regulator') return { wCells: 4, hCells: 3 + n };
	return { wCells: 3, hCells: 2 + n };
}

function buildColumns(modules) {
	const present = [...new Set(modules.map(m => m.column))]
		.sort((a, b) => COLUMN_ORDER[a] - COLUMN_ORDER[b]);
	return present.map((origin, order) => ({
		id: COLUMN_META[origin].id,
		role: COLUMN_META[origin].role,
		order,
		modules: modules.filter(m => m.column === origin).map(m => m.id).sort(),
	}));
}

function placeModules(modules, columns) {
	const out = [];
	for (const col of columns) {
		const inCol = modules
			.filter(m => COLUMN_META[m.column].id === col.id)
			.sort(byId);
		let cursor = 0;
		for (const m of inCol) {
			const { wCells, hCells } = sizeOf(m.role, m.parts.length);
			out.push({
				id: m.id, role: m.role, column: col.id, parts: m.parts.slice(),
				region: { col: col.order, row: cursor, wCells, hCells },
				gap: { left: 1, right: 1, top: 1, bottom: 1 },
			});
			cursor += hCells + ROW_GAP;
		}
	}
	return out.sort(byId);
}

export function synthesizeContract(roles, logical, opts = {}) {
	if (!roles || !Array.isArray(roles.modules)) {
		throw new TypeError('synthesizeContract: roles.modules required');
	}
	const grid = { colPitch: opts.colPitch ?? 10, rowPitch: opts.rowPitch ?? 10 };
	const columns = buildColumns(roles.modules);
	const modules = placeModules(roles.modules, columns);
	return {
		schemaVersion: 1,
		grid,
		columns: columns.map(c => ({ id: c.id, role: c.role, order: c.order, modules: c.modules })),
		modules,
		labelColumns: [],
		routingChannels: [],
		meta: {
			controller: roles.controller ?? null,
			moduleCount: roles.modules.length,
			columnCount: columns.length,
		},
	};
}

export function contractQC(contract) {
	return [];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test engine/design_contract.test.mjs`
Expected: PASS（2 个用例;此时 `contractQC` 仍为占位空实现,Task 3 补全）。

- [ ] **Step 5: 提交**

```bash
git add engine/design_contract.mjs engine/design_contract.test.mjs
git commit -m "feat: synthesize contract columns and module regions from audit model"
```

---

### Task 2: synthesizeContract 标签列 + 布线通道

**Files:**
- Modify: `engine/design_contract.mjs`
- Test: `engine/design_contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `synthesizeContract`(扩展其内部);`logical.nets`(class/pins)。
- Produces: `contract.labelColumns:[{id:'<net>@<moduleId>', net, module, side:'left'|'right', routeEnd:'from'|'to', class:'signal'}]`、`contract.routingChannels:[{id:'<a>-><b>', betweenColumns:[a,b], widthCells}]`。规则:仅跨模块(引脚分布在 ≥2 模块)的 `signal` 网出标签;源模块(列 order 最小,平手取 id 最小)端 `routeEnd:'from'`,其余 `'to'`;模块在网"重心"左侧→`side:'right'`,否则 `'left'`。

- [ ] **Step 1: 写失败测试** —— 追加到 `engine/design_contract.test.mjs`

```javascript
test('标签列:跨模块 signal 网出标签;power/ground 不出;源端 routeEnd=from', () => {
	const nets = contract.labelColumns.map(l => l.net);
	assert.ok(nets.includes('LED_CTRL'));       // mctrl + LED 模块 → 跨模块
	assert.ok(nets.includes('USB_DP_MCU'));     // R1 模块 + mctrl → 跨模块
	assert.ok(!nets.includes('USB_DP'));        // J1 与 R1 同模块 → 不出
	assert.ok(!nets.includes('VCC_3V3'));       // power
	assert.ok(!nets.includes('GND'));           // ground
	assert.ok(contract.labelColumns.every(l => l.class === 'signal'));
	const led = contract.labelColumns.filter(l => l.net === 'LED_CTRL');
	assert.equal(led.length, 2);                // 两个端模块各一条
	assert.equal(led.filter(l => l.routeEnd === 'from').length, 1);
});

test('布线通道:相邻列之间各一条', () => {
	assert.equal(contract.routingChannels.length, contract.columns.length - 1);
	assert.deepEqual(contract.routingChannels[0].betweenColumns, ['input', 'control']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/design_contract.test.mjs`
Expected: FAIL —— `labelColumns` 为空数组,断言 `nets.includes('LED_CTRL')` 失败。

- [ ] **Step 3: 写实现** —— 在 `engine/design_contract.mjs` 顶部辅助区后加入两个构造函数,并在 `synthesizeContract` 内接线

加入辅助函数(放在 `placeModules` 之后):

```javascript
const refOfPin = p => p.slice(0, p.lastIndexOf('.'));

function buildLabelColumns(modules, columns, nets) {
	const moduleByRef = new Map();
	for (const m of modules) for (const r of m.parts) moduleByRef.set(r, m);
	const orderOf = m => columns.find(c => c.id === COLUMN_META[m.column].id).order;
	const labels = [];
	for (const net of nets) {
		if (net.class !== 'signal') continue;
		const mods = [...new Set(net.pins.map(refOfPin).map(r => moduleByRef.get(r)).filter(Boolean))];
		if (mods.length < 2) continue;
		const source = mods.slice().sort((a, b) => orderOf(a) - orderOf(b) || byId(a, b))[0];
		for (const m of mods) {
			const others = mods.filter(x => x !== m);
			const avgOther = others.reduce((s, x) => s + orderOf(x), 0) / others.length;
			labels.push({
				id: `${net.name}@${m.id}`,
				net: net.name,
				module: m.id,
				side: orderOf(m) <= avgOther ? 'right' : 'left',
				routeEnd: m === source ? 'from' : 'to',
				class: 'signal',
			});
		}
	}
	return labels.sort(byId);
}

function buildChannels(columns) {
	const out = [];
	for (let i = 0; i + 1 < columns.length; i++) {
		out.push({
			id: `${columns[i].id}->${columns[i + 1].id}`,
			betweenColumns: [columns[i].id, columns[i + 1].id],
			widthCells: 2,
		});
	}
	return out;
}
```

在 `synthesizeContract` 中替换两处占位空数组:

```javascript
	const labelColumns = buildLabelColumns(roles.modules, columns, (logical && logical.nets) || []);
	const routingChannels = buildChannels(columns);
	return {
		schemaVersion: 1,
		grid,
		columns: columns.map(c => ({ id: c.id, role: c.role, order: c.order, modules: c.modules })),
		modules,
		labelColumns,
		routingChannels,
		meta: {
			controller: roles.controller ?? null,
			moduleCount: roles.modules.length,
			columnCount: columns.length,
		},
	};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test engine/design_contract.test.mjs`
Expected: PASS（4 个用例)。

- [ ] **Step 5: 提交**

```bash
git add engine/design_contract.mjs engine/design_contract.test.mjs
git commit -m "feat: derive label columns and routing channels in synthesis contract"
```

---

### Task 3: contractQC 自洽校验 + 确定性/空/负例

**Files:**
- Modify: `engine/design_contract.mjs`
- Test: `engine/design_contract.test.mjs`

**Interfaces:**
- Consumes: Task 1/2 的 `synthesizeContract` 产出 `contract`。
- Produces: `contractQC(contract) -> [{rule, severity:'hard'|'info', message, where?}]`。规则:`DC0-empty`(info,无模块)、`DC1-module-column-membership`、`DC2-column-order`、`DC3-region-overlap`、`DC4-label-orphan`、`DC4-label-duplicate`、`DC5-label-class`(均 hard)。合法 contract 返回空 hard。

- [ ] **Step 1: 写失败测试** —— 追加到 `engine/design_contract.test.mjs`

```javascript
test('contractQC:合法 contract 无 hard finding', () => {
	const hard = contractQC(contract).filter(f => f.severity === 'hard');
	assert.deepEqual(hard, []);
});

test('确定性:同输入两次合成深相等', () => {
	assert.deepEqual(synthesizeContract(roles, logical), synthesizeContract(roles, logical));
});

test('空模块:contractQC 报 DC0-empty(info)', () => {
	const empty = synthesizeContract({ controller: null, parts: [], modules: [] }, { parts: [], nets: [] });
	const info = contractQC(empty).filter(f => f.rule === 'DC0-empty');
	assert.equal(info.length, 1);
	assert.equal(info[0].severity, 'info');
});

test('contractQC 负例:重叠区→DC3、孤儿标签→DC4、power 标签→DC5', () => {
	const bad = JSON.parse(JSON.stringify(contract));
	const byCol = {};
	for (const m of bad.modules) (byCol[m.region.col] ||= []).push(m);
	const dup = Object.values(byCol).find(a => a.length >= 2);
	dup[1].region.row = dup[0].region.row;          // 强制同列重叠
	bad.labelColumns.push({ id: 'X@ghost', net: 'X', module: 'ghost', side: 'left', routeEnd: 'from', class: 'signal' });
	bad.labelColumns.push({ id: 'P@' + bad.modules[0].id, net: 'P', module: bad.modules[0].id, side: 'left', routeEnd: 'from', class: 'power' });
	const rules = new Set(contractQC(bad).map(f => f.rule));
	assert.ok(rules.has('DC3-region-overlap'));
	assert.ok(rules.has('DC4-label-orphan'));
	assert.ok(rules.has('DC5-label-class'));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test engine/design_contract.test.mjs`
Expected: FAIL —— `contractQC` 仍为占位空实现,负例与空模块断言失败。

- [ ] **Step 3: 写实现** —— 用完整实现替换 `engine/design_contract.mjs` 末尾的占位 `contractQC`

```javascript
export function contractQC(contract) {
	const findings = [];
	const mods = contract.modules || [];
	const cols = contract.columns || [];

	if (!mods.length) {
		findings.push({ rule: 'DC0-empty', severity: 'info', message: '空 contract：无模块' });
	}

	// DC1:每模块恰好属于一列
	const membership = new Map();
	for (const c of cols) for (const id of c.modules) membership.set(id, (membership.get(id) || 0) + 1);
	for (const m of mods) {
		const k = membership.get(m.id) || 0;
		if (k !== 1) {
			findings.push({ rule: 'DC1-module-column-membership', severity: 'hard',
				message: `模块 ${m.id} 属于 ${k} 个列(应恰好 1)`, where: { module: m.id } });
		}
	}

	// DC2:列 order 密集唯一 + 控制器列位于输入/输出之间
	const orders = cols.map(c => c.order).slice().sort((a, b) => a - b);
	if (!orders.every((o, i) => o === i)) {
		findings.push({ rule: 'DC2-column-order', severity: 'hard', message: `列 order 非密集唯一:${orders.join(',')}` });
	}
	const idx = Object.fromEntries(cols.map(c => [c.id, c]));
	if (idx.control && idx.input && idx.output &&
		!(idx.input.order < idx.control.order && idx.control.order < idx.output.order)) {
		findings.push({ rule: 'DC2-column-order', severity: 'hard', message: '控制器列未位于输入/输出列之间' });
	}

	// DC3:同列模块区不重叠
	const perCol = new Map();
	for (const m of mods) {
		if (!perCol.has(m.region.col)) perCol.set(m.region.col, []);
		perCol.get(m.region.col).push(m);
	}
	for (const list of perCol.values()) {
		const sorted = list.slice().sort((a, b) => a.region.row - b.region.row);
		for (let i = 1; i < sorted.length; i++) {
			const prev = sorted[i - 1], cur = sorted[i];
			if (cur.region.row < prev.region.row + prev.region.hCells) {
				findings.push({ rule: 'DC3-region-overlap', severity: 'hard',
					message: `模块 ${prev.id} 与 ${cur.id} 区重叠`, where: { modules: [prev.id, cur.id] } });
			}
		}
	}

	// DC4/DC5:标签列引用存在、不重复、必为 signal 类
	const modIds = new Set(mods.map(m => m.id));
	const seen = new Set();
	for (const l of contract.labelColumns || []) {
		if (!modIds.has(l.module)) {
			findings.push({ rule: 'DC4-label-orphan', severity: 'hard',
				message: `标签列引用不存在模块 ${l.module}`, where: { label: l.id } });
		}
		if (seen.has(l.id)) {
			findings.push({ rule: 'DC4-label-duplicate', severity: 'hard', message: `重复标签列 ${l.id}` });
		}
		seen.add(l.id);
		if (l.class !== 'signal') {
			findings.push({ rule: 'DC5-label-class', severity: 'hard',
				message: `标签列 ${l.id} 非 signal 类(${l.class})`, where: { label: l.id } });
		}
	}

	return findings;
}
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `node --test engine/design_contract.test.mjs`
Expected: PASS（全部 8 个用例)。

Run: `node --test engine/*.test.mjs`
Expected: PASS,`tests` 计数 > 44(应为 52)。

Run: `npm test`
Expected: `pipeline_fast` 仍 `Score 100/100 | PASS`(无回归)。

- [ ] **Step 5: 提交**

```bash
git add engine/design_contract.mjs engine/design_contract.test.mjs
git commit -m "feat: add contractQC self-consistency validator for synthesis contract"
```

---

### Task 4(可选): 只读 CLI 运行器 `plexus contract`

**Files:**
- Create: `engine/plexus_contract.mjs`
- Modify: `bin/easyeda-plexus.mjs`(`usage()` 加一行 + `switch` 加一个 `case`)

**Interfaces:**
- Consumes: `extractLogical`、`inferRoles`、`synthesizeContract`、`contractQC`。
- Produces: 只读运行器,从 `live.json` 经 extract→infer→synthesize→QC 写 `plexus_contract_report.json`;`bin/easyeda-plexus.mjs contract` 子命令转发到它。镜像现有 `plexus_audit.mjs` / `audit` 子命令。不写回工程文件。

- [ ] **Step 1: 创建运行器** —— `engine/plexus_contract.mjs`

```javascript
// Plexus 合成契约 CLI:快照 → 抽取 → 角色 → 合成契约 + 自洽校验 → 报告(只读)。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract, contractQC } from './design_contract.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const LIVE = process.env.EASYEDA_LIVE_MODEL || `${ROOT}/live.json`;
const REPORT = process.env.PLEXUS_CONTRACT_REPORT || `${ROOT}/plexus_contract_report.json`;

export function runPlexusContract() {
	if (!existsSync(LIVE)) {
		return { ok: false, error: `快照缺失：${LIVE}（先跑 plexus live:save / audit 拉快照）` };
	}
	const snap = JSON.parse(readFileSync(LIVE, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const roles = inferRoles(logical);
	const contract = synthesizeContract(roles, logical);
	const findings = contractQC(contract);
	return { ok: true, contract, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const r = runPlexusContract();
	if (!r.ok) { console.error(r.error); process.exit(2); }
	const hard = r.findings.filter(f => f.severity === 'hard');
	writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), ...r }, null, 2), 'utf8');
	console.log(`Plexus 合成契约:列=${r.contract.columns.length} 模块=${r.contract.meta.moduleCount} 标签=${r.contract.labelColumns.length} hard=${hard.length}`);
	for (const f of hard) console.log(`  [hard] ${f.rule} ${f.message}`);
	console.log(`report -> ${REPORT}`);
	process.exit(hard.length ? 1 : 0);
}
```

- [ ] **Step 2: 接线 bin** —— 在 `bin/easyeda-plexus.mjs` 的 `usage()` Commands 区 `audit` 行下加一行:

```
  contract                     Synthesize the generic layout contract (extract netlist + roles → tokens + self-check) from the live snapshot.
```

并在 `switch (cmd)` 中 `case 'audit':` 块之后加入:

```javascript
		case 'contract':
			runNode(['engine/plexus_contract.mjs', ...args]);
			break;
```

- [ ] **Step 3: 冒烟验证(无 live.json 时应给出可执行指引,退出码 2)**

Run: `node bin/easyeda-plexus.mjs contract`
Expected: 若仓库无 `live.json`,打印 `快照缺失：…` 并退出码 2(只读、不写回);若存在 `live.json`,打印一行汇总并写 `plexus_contract_report.json`。

- [ ] **Step 4: 提交**

```bash
git add engine/plexus_contract.mjs bin/easyeda-plexus.mjs
git commit -m "feat: add read-only 'plexus contract' CLI runner"
```

---

## Self-Review

**1. Spec coverage:**
- 通用合成 schema(§4 token 词汇)→ Task 1(columns/modules)+ Task 2(labelColumns/routingChannels/meta)。✓
- 派生规则(列/模块区/标签/通道)→ Task 1 `buildColumns`/`placeModules` + Task 2 `buildLabelColumns`/`buildChannels`。✓
- 6 条自洽不变量(§5)→ Task 3 `contractQC`(不变量 1=DC1,2=DC2,3=DC3,4=DC4,5=DC5;不变量 6 确定性由 Task 3 测试断言)。覆盖性(不变量 4 "每条跨模块网被覆盖")由 Task 2 测试断言(LED_CTRL 两条),contractQC 仅校验孤儿/重复——已在 spec §5 注明 contractQC 只做契约内部校验。✓
- 错误处理(§6)→ Task 1 `synthesizeContract` 抛 `TypeError`;空模块 → Task 3 DC0;无控制器 → `buildColumns` 自然无 control 列(由 present 集合驱动)。✓
- 测试(§7)→ Task 1-3 共 8 用例(正/负/确定性/空)。✓
- 可选 CLI(§8)→ Task 4。✓
- 文件清单(§9)与验收标准(§10)→ Task 3 Step 4 全量回归命令。✓

**2. Placeholder scan:** 无 TBD/TODO;每个代码步均含完整代码;Task 1 的占位空 `labelColumns`/`routingChannels`/`contractQC` 在 Task 2/3 明确替换,非遗留占位。✓

**3. Type consistency:** `synthesizeContract`/`contractQC` 签名跨任务一致;`byId`、`COLUMN_META`、`refOfPin`、`orderOf` 命名一致;`region.{col,row,wCells,hCells}`、`labelColumns[].{id,net,module,side,routeEnd,class}`、findings `{rule,severity,message,where}` 字段跨 Task 1-4 一致。✓

## Execution Handoff

见对话:计划保存后向用户提供执行方式选择。

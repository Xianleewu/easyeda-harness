# Plexus Phase 3 · layout_planner 通用驱动(第一刀)设计

- 日期:2026-06-18
- 范围:Phase 3「合成」第三块——把 design_contract 的模块区落成 archetype cell 并组装成可过门的模型。本刀只做 **contract→placement 通用驱动**:逐模块取 archetype、按列×纵序定位、渲染、合并、跑真实 geomQC/labelQC。
- 不在本轮:跨模块布线求解器(labelColumns/channels 的模块间走线)、六支柱迭代收敛、可逆写回、power/ground 端点网的自动派生(本刀由 opts 传入)。

## 1. 背景与动机

Slice 1 交付 `design_contract`(抽象网格模块区/标签列),Slice 2 交付 archetype(角色→cell)。本刀把两者**端到端打通**:给定一个 design_contract + 零件库 + 角色,自动把每个模块落成真实 cell 几何并组装,证明"契约→摆放→cell→几何"链条可过真实 geomQC/labelQC。

关键阻抗:design_contract 的 `region.row` 是抽象格单位,archetype 用 60px/件的真实像素——直接相乘会量纲失配。本刀用**逐列游标两遍式**:按列分组、列内按 `region.row` 排序,用每个模块的**实际渲染高度**累进游标定位,从构造上杜绝重叠,把 `region` 当"列×纵序"排序提示而非精确像素。

## 2. 决策(已与用户确认)

1. 本刀切片 = **contract→placement 通用驱动**;真实 geomQC/labelQC 断 `hard=0`。
2. planner 是**新建解耦**驱动,**不**复用现有 `engine/assemble.mjs`(那是 project_assembly.json 驱动、AIHWDEBUGER 耦合的生成轨道组装器)。
3. 定位用逐列游标 + 实际渲染高度(非 region×pitch 直乘),杜绝重叠。
4. fail-closed 可见性:无 archetype / 缺件的模块进 `skipped`,不静默丢。

## 3. 架构与数据流

```
design_contract + byDes + opts → planLayout() → { model, placed, skipped }
  按 region.col 分列、列内按 region.row 排序,逐模块:
    getArchetype(role)            ──无──▶ skipped += {module, reason:'no-archetype'}
    从 byDes 解析 parts           ──缺──▶ skipped += {module, reason:'missing-parts'}
    anchor = (origin.x + col*colWidth, cursorY[col])
    nets.side  ← contract.labelColumns 中属该模块的首个 signal 标签
    nets.top/bottom ← opts.endpointNets?.[moduleId]
    cell = renderArchetype(role, {parts, anchor, nets})
    cursorY[col] -= (cell.region 高度 + GAP)        // 两遍游标,实际高度,杜绝重叠
    收集 worldComponent(parts) + cell.wires + cell.flags
  合并 → model = { components, wires, netflags }
（test:model 跑真实 geomQC/labelQC 断 hard=0)
```

新增 `engine/plexus_planner.mjs`(引擎级通用驱动,与生成轨道解耦)。纯函数、确定性。

## 4. 接口

```jsonc
planLayout({ contract, byDes, opts }) -> {
  model:   { components:[{designator,pins:[{num,x,y}],bbox}], wires:[…], netflags:[…] },
  placed:  [ moduleId ],
  skipped: [ { module, reason } ]    // reason: 'no-archetype' | 'missing-parts'
}
```

- `contract`:`synthesizeContract` 的产物(modules 带 region/role/parts;labelColumns;columns;grid)。
- `byDes`:`Map<designator, {designator, pins:[{num,local}], localBox}>`(normalize 后的零件库)。
- `opts`:`{ origin?:{x,y}=({x:1000,y:1000}), colWidth?=400, rowGap?=80, endpointNets?:{[moduleId]:{top?:{name,class},bottom?:{name,class}}} }`。

## 5. 定位与组装(逐列游标)

- 列 x:`origin.x + region.col * colWidth`(列严格分离,colWidth 远大于单模块宽)。
- `worldComponent(part, place)`:由 cell.place + 零件 local 引脚/localBox 经 `toWorld` 算世界引脚 + bbox(复刻 `divider_pack_smoke` 的核心组装一步)。
- 模块**真实范围** `cellExtent`:对该模块所有 worldComponent.bbox 角点 + cell.wires 顶点 + cell.flags 坐标取最小/最大 y(以及 x)。注意:**不**用 `cell.region`——它由 archetype 仅按引脚点算,**不含 power/gnd/标签桩端**(Slice 2 已知限制),用它推游标会让桩与邻居重叠。
- 列内纵向:游标 `cursorY[col]` 初始 `origin.y`;每模块 anchor.y = 当前 `cursorY[col]`;渲染后 `cursorY[col] = cellExtent.minY - rowGap`(下一模块 anchor 落在本模块真实底部之下 rowGap 处)→ 同列模块(含桩)绝不重叠,由测试 `geomQC overlaps=0` 兜底验证。
- 合并:所有模块的 worldComponent 入 `model.components`,`cell.wires` 入 `model.wires`,`cell.flags` 入 `model.netflags`。

## 6. 错误处理 / fail-closed

- 纯函数、入口快失败(contract/byDes 缺失或畸形 → 抛错)。
- 模块 role 无对应 archetype → 进 `skipped`(reason `no-archetype`),不渲染、不静默丢。
- 模块 parts 在 byDes 缺失 → 进 `skipped`(reason `missing-parts`)。
- archetype 渲染抛错(如非 2 端件)→ 冒泡(不吞);调用方据此修契约/库。
- 返回部分 model + 完整 skip 报告,调用方可见全部未落地模块。

## 7. 测试

`engine/plexus_planner.test.mjs`(node:test,中文用例):

- 合成一个最小 contract:2 个 `support` 模块分属 2 列(各含 2–3 个无源件 + 1 条 signal labelColumn)+ 1 个 `controller` 模块(无 archetype);合成 byDes 提供无源件(带 local 引脚)。
- 断言:`placed` 含 2 个 support 模块、`skipped` 含 controller(reason `no-archetype`)。
- 组装出的 `model` 跑**真实** `geomQC`:overlaps/wireThruComp/offgrid/crossings 全 0;`labelQC`:hard=0。
- 确定性:同输入两次 `planLayout` 的 model 深相等。
- 负例:缺件模块进 `skipped`(reason `missing-parts`);畸形 contract 抛错。
- 目标:并入现有 62 绿、零回归;`npm test` 100/100 不变。

## 8. 已知限制(留待后续切片)

- 无跨模块布线:各模块是独立"岛"(自身链+桩+侧标签),模块间不连线(布线求解器是 Slice 4)。
- power/ground 端点网由 `opts.endpointNets` 传入;从 `logical` 自动派生留待后续。
- 每模块仅取首个 signal labelColumn 作侧标签;多侧信号留待后续。
- `region.col`/`region.row` 仅用作列归属与列内纵序;模块间距用真实几何范围 + 固定 rowGap(非 region 尺寸)。精确紧凑(回填修正 archetype region 使其含桩,再用其紧排)留待后续。

## 9. 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `engine/plexus_planner.mjs` | 新增 | `planLayout({contract,byDes,opts})` 通用驱动 |
| `engine/plexus_planner.test.mjs` | 新增 | 单测 + 真实 geomQC/labelQC 组装断言 |

## 10. 验收标准

- `planLayout` 对 2-support+1-controller 的合成 contract 产出 `placed` 含 2、`skipped` 含 controller。
- 组装 model 跑真实 geomQC 全 0、labelQC hard=0。
- 缺件/畸形输入按 fail-closed 处理(skipped 或抛错);确定性;并入套件零回归;`npm test` 100/100。

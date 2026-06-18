# Plexus Phase 3 · archetype 角色化原型库(第一刀)设计

- 日期:2026-06-18
- 范围:Phase 3「合成」第二块——为推断角色提供"角色→标准 cell"的通用绘制原型。本刀只交付**接口契约 + 角色注册表 + 1 个参考原型(support)**,用真实 geomQC/labelQC 冒烟证明可过门。
- 不在本轮:其余角色原型(connector/regulator/controller/indicator/switch…)、layout_planner 通用驱动、design_contract→archetype 的自动接线、写回。

## 1. 背景与动机

Slice 1 已交付 `engine/design_contract.mjs`:从审计模型派生抽象网格布局契约(列/模块区/标签列/通道)。但契约是**抽象的**——没有任何真实 cell 几何。

本刀建立"角色→cell"的通用绘制层:把现有手写 cell(如 `dividerCell`)泛化成**按角色**参数化的原型,完全基于成熟的 `engine/cell_helpers.mjs` 原语(正交线、模块矩形、标签列附着、GND/电源短桩、净空校验)。这是日后 layout_planner 把 design_contract 模块区落成真实几何的零件库。

## 2. 决策(已与用户确认)

1. 本刀切片 = archetype **接口契约 + 注册表 + 1 个参考原型(support)**;真实 geomQC/labelQC 冒烟证明,`hard=0`。
2. 参考原型 = **support 无源件竖直串**(泛化 `dividerCell` 到 N 个 2 端无源件)。
3. 位置 = `circuit_packs/archetypes/`(贴合路线图命名;archetype 是引擎级通用、按角色,不是具体电路 pack)。
4. 测试强度 = 单测(几何 + cell_helpers 自带校验 + 确定性)**加** geomQC/labelQC 冒烟(复刻 `engine/divider_pack_smoke.mjs` 范式)。

## 3. 架构与数据流

```
（本轮)  parts + anchor + nets  →  renderArchetype(role, spec)  →  cell
                                          ↓ getArchetype(role)
                                     supportArchetype(spec)  ← 用 cell_helpers 画几何
（日后 planner)  design_contract 模块区 ×pitch → anchor;labelColumns → nets;逐模块 renderArchetype 落地
```

新增目录 `circuit_packs/archetypes/`:

- `registry.mjs` — `getArchetype(role)`(role→原型 fn)+ `renderArchetype(role, spec)` 薄分发。
- `support.mjs` — `supportArchetype(spec)` 参考原型。
- `support.test.mjs` — 单测 + geomQC/labelQC 冒烟。

约束:纯函数、不可变、确定性(按 parts 顺序、坐标量化,禁 `Date.now`/`Math.random`)。

## 4. archetype 统一接口

```jsonc
// renderArchetype(role, spec) → cell
spec = {
  parts:  [ { designator, pins:[{num, local:[x,y]}], localBox } ],  // 模块元件(normalize 后形态,带 .local)
  anchor: { x, y },                       // 绝对落点(本轮调用方给;日后 planner 由 region×pitch 算)
  nets:   { top?:{name,class}, bottom?:{name,class}, side?:{name,class} },  // 各端点网名+类;均可选
  opts:   { orient?: 'v', tapIndex?: 0 }  // 本轮仅竖直;tapIndex 选侧出 signal 接哪个链内结点
}
cell = {
  place:      { [designator]: { x, y, rot, mirror } },
  wires:      [ { net, line:[...] } ],
  flags:      [ { kind:'sig'|'gnd'|'power', net, x, y, ... } ],
  noConnects: [],
  region:     { minX, minY, maxX, maxY }   // 原型实际占用矩形(regionOf 算)
}
```

- `place`/`wires`/`flags`/`noConnects` 与现有 cell builder 输出**同形**,可被同一套 `geomQC`/`labelQC` 校验。
- 额外 `region`:供日后 planner 验证落点与 design_contract 模块区一致。
- `getArchetype(role)` 查不到角色时**抛错**(明确,不静默兜底)。

## 5. 参考原型 `supportArchetype`(无源件竖直串)

把 `dividerCell` 泛化为 **N 个 2 端无源件竖直串接**:

- 摆放:每件 `rot 90`,沿 y 轴自上而下等距堆叠(间距取 cell_helpers `GRID` 的整数倍,量化对齐)。
- 串接:相邻件 `上件.pin1(下)` → `下件.pin2(上)` 用**无网名**正交线连接(必要时 `elbow`)。
- 端点出桩(按 `nets` 的类):
  - 顶端 `power` 网 → `powerStub(net, 顶点, {dir:'up'})`。
  - 底端 `ground` 网 → `gndStub(底点, {dir:'down'})`。
  - 侧出 `signal` 网 → 接在**链内结点**(N 件有 N−1 个内部结点,`opts.tapIndex` 选第几个,缺省 0;2 件链即中点,等价 `dividerCell` 的 VMID)→ `labelStub(net, 结点, {side:'right'})`(命名水平 stub + 网标,`alignMode=8`)。
- 全程用 `engine/cell_helpers.mjs`,**不手摆任何线/标签**;`mergeParts` 汇总。
- `region` 由 `regionOf(所有引脚点 + localBox 角点)` 算。

确定性:`place` 与几何只依赖 `parts` 顺序与 `anchor`,无随机、无时钟。

## 6. 错误处理

- 纯函数、入口快失败,绝不静默吞错。
- 空 `parts` → 抛错;未知 role → `getArchetype` 抛错。
- 传入 support 的元件非 2 端 → 抛错(明确约束;非 2 端拓扑留给日后其它原型)。
- `nets` 缺类 → 该端不出桩(不产生假网标);cell_helpers 已对斜线/浮空标签/超长桩 fail-fast,继承之。

## 7. 测试

`circuit_packs/archetypes/support.test.mjs`(node:test,中文用例):

- 单测:
  - place 坐标/旋转正确(竖直等距、rot 90)。
  - `assertOrthogonalWires(cell.wires)` 通过。
  - `assertLabelsAttached(cell.wires, cell.flags)` 通过。
  - `region` 为合理包围矩形。
  - 确定性:同输入两次深相等。
  - 负例:空 parts / 未知 role / 非 2 端元件 → 抛错。
- 冒烟(复刻 `divider_pack_smoke` 范式):合成 2–3 个无源件 → `supportArchetype` → `worldComponent`(用 `toWorld`)组装 `model{components,wires,netflags}` → 跑**真实** `geomQC(model)` 断 `overlaps/wireThruComp/offgrid/crossings` 全 0、`labelQC(model)` 断 `hard=0`。
- 目标:并入现有 52 绿、零回归(`node --test engine/*.test.mjs` + 新测全绿;`npm test` 100/100 不变)。

## 8. 可选(不扩范围)

把冒烟挂进 `workflow:smoke` 作一条新门(像 WS25 守护 divider),CI 长期防回退。默认**不挂**(避免改 smoke gate 文件),用户要再说。

## 9. 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `circuit_packs/archetypes/registry.mjs` | 新增 | `getArchetype` + `renderArchetype` |
| `circuit_packs/archetypes/support.mjs` | 新增 | `supportArchetype` 参考原型 |
| `circuit_packs/archetypes/support.test.mjs` | 新增 | 单测 + geomQC/labelQC 冒烟 |

## 10. 验收标准

- `renderArchetype('support', spec)` 对合成无源件串产出同形 cell。
- 冒烟:组装 model 跑真实 geomQC `overlaps/wireThruComp/offgrid/crossings=0` 且 labelQC `hard=0`。
- 单测覆盖几何/确定性/负例;并入现有套件零回归;`npm test` 100/100。
- 未知 role / 空 parts / 非 2 端元件 均快失败并由测试断言。

# Plexus Phase 3 · fanout(多引脚扇出)archetype 设计

- 日期:2026-06-18
- 范围:Phase 3 archetype 库扩展——为**多引脚枢纽器件**(连接器等)提供"角色→cell"原型。本刀交付 `fanoutArchetype` + 注册给 `connector` 角色 + 真实 geomQC/labelQC 冒烟。
- 动机:在真实 live.json(50 模块)上跑整条合成链,34 个 support 模块落地,但 16 个结构模块(connector/ic/controller/regulator/indicator/input/switch/other)全因无 archetype 被跳过。多引脚枢纽是结构价值最高的一类,先补它。
- 不在本轮:ic/controller/regulator 的注册(注册表后续可指向同一 fanout)、2 端 indicator/input 的注册、跨模块布线、pinNets 的自动派生(本刀由调用方/opts 传入)。

## 1. 决策(standing「按你推荐的进行」批准)

1. 新增 `fanoutArchetype`:单个多引脚器件 → 摆放 + 每引脚按网类水平扇出标签/桩。
2. 注册给 `connector`(`circuit_packs/archetypes/registry.mjs` 加一条)。
3. **所有引脚一律水平扇出到本侧**(side 由 `pin.local.x` 正负决定),杜绝堆叠引脚的桩纵向相撞。
4. 真实 geomQC/labelQC 冒烟 `hard=0`;与前几切片同构。

## 2. 架构与数据流

```
parts(一个多引脚器件) + anchor + pinNets → fanoutArchetype(spec) → { place, wires, flags, noConnects, region }
   器件 rot 0 摆 anchor;逐引脚 world = toWorld(pin.local, anchor, 0, false):
     该引脚有 pinNets 条目:
       signal → labelStub(net, world, {side, escX})
       power  → powerStub(net, world, {dir: side, len:50})
       ground → gndStub(world, {dir: side, len:30, net})
     无 pinNets 条目的引脚 → 不出桩(未连)
   mergeParts 汇总;region = regionOf(引脚点, pad)
（日后 planner:从 netlist 派生 pinNets;注册表把 ic/controller/regulator 也指向 fanout)
```

新增 `circuit_packs/archetypes/fanout.mjs`,完全用 `engine/cell_helpers.mjs` 构建。纯函数、确定性。

## 3. 接口

```jsonc
fanoutArchetype(spec) -> { place:{[des]:{x,y,rot,mirror}}, wires, flags, noConnects:[], region }
spec = {
  parts:  [ { designator, pins:[{num, local:[x,y]}], localBox } ],   // 恰一个多引脚器件
  anchor: { x, y },
  nets:   { pinNets: { [pinNum]: { name, class } } },   // 各引脚网名+类(power/ground/signal)
  opts:   {}
}
```

- `side` 规则:`pin.local[0] >= 0 → 'right'`,否则 `'left'`;`powerStub`/`gndStub` 的 `dir` 取该 side(水平),`labelStub` 的 `side` 取该 side。
- 输出同形,可被同一套 geomQC/labelQC 校验;`region` 供 planner 验证。

## 4. 参考几何 `fanoutArchetype`

- 摆放:器件 `rot 0` 在 anchor(`place[designator] = {x:anchor.x, y:anchor.y, rot:0, mirror:false}`)。
- 逐引脚:`world = toWorld(pin.local, [anchor.x, anchor.y], 0, false)`;`side = pin.local[0] >= 0 ? 'right' : 'left'`。
- 按 `pinNets[pin.num].class`:
  - `signal` → `labelStub(name, world, { side, escX: world[0] + (side==='right'?30:-30) })`。
  - `power`  → `powerStub(name, world, { dir: side, len: 50 })`。
  - `ground` → `gndStub(world, { dir: side, len: 30, net: name })`。
  - 无条目 → 跳过(未连引脚不出假桩/假标)。
- 全程 `engine/cell_helpers.mjs`;`mergeParts` 汇总;`region = regionOf(所有引脚 world 点, 20)`。
- 确定性:按 `pins` 顺序处理,无随机无时钟。

## 5. 错误处理 / fail-closed

- 纯函数、入口快失败。`parts` 非恰一个器件 → 抛错(thin slice 限单器件)。
- 器件无引脚 → 抛错。
- `pinNets` 引用器件上不存在的引脚号 → 抛错(坏输入)。
- 继承 cell_helpers 对斜线/浮空标签/超长桩的 fail-fast。

## 6. 测试

`circuit_packs/archetypes/fanout.test.mjs`(node:test,中文用例):

- 合成一个双侧多引脚 connector(如左 3 脚、右 3 脚),`pinNets` 覆盖 signal/power/ground 各类。
- 单测:place(rot 0、在 anchor);`assertOrthogonalWires` 过;`assertLabelsAttached` 过;flags 含 sig/power/gnd;`region` 合理;确定性;负例(空 parts / 多器件 / pinNets 指向不存在引脚 → 抛错)。
- 冒烟:`worldComponent` 组装 `model{components,wires,netflags}` → 真实 `geomQC`(overlaps/wireThruComp/offgrid/crossings=0)+ `labelQC`(hard=0)。
- 注册表:`getArchetype('connector')` 返回 `fanoutArchetype`;现有 `support` 不受影响。
- 目标:并入现有 70 绿、零回归;`npm test` 100/100。

## 7. 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `circuit_packs/archetypes/fanout.mjs` | 新增 | `fanoutArchetype` |
| `circuit_packs/archetypes/fanout.test.mjs` | 新增 | 单测 + geomQC/labelQC 冒烟 |
| `circuit_packs/archetypes/registry.mjs` | 改 | 加 `connector: fanoutArchetype` |

## 8. 验收标准

- `fanoutArchetype` 对合成多引脚 connector 产出同形 cell;组装 model 过真实 geomQC 全 0、labelQC hard=0。
- `getArchetype('connector')` 命中 fanout;`support` 不回归。
- 负例快失败;确定性;并入套件零回归;`npm test` 100/100。

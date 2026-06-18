# Plexus Phase 3 · planner 摆放格对齐(slice 5)设计

- 日期:2026-06-18
- 范围:修复 planner 在真实零件上产生离格几何(probe 实测 `geomQC.offgrid=68`)。

## 1. 问题(真实数据发现)

在 live.json(50 模块)跑 `extract→infer→contract→plan`,placed 35、overlaps/wireThruComp/crossings 全 0,但 **offgrid=68**。

根因:真实件 local 引脚格对齐(10 倍数),但 `localBox` 为分数(如 `-75.5`)。planner 列游标 `cursorY = cellExtentMinY(...) - rowGap` 取了分数 localBox 的范围 → cursorY 分数 → 后续模块 `anchor.y` 分数 → `分数锚点 + 格 local` = 引脚离格(首模块 anchor=origin 格对齐除外;其余 34 模块各 ~2 脚离格 ≈ 68)。

## 2. 修法(决策,standing 批准)

planner 给每个模块的 **`anchor.y` 量化到格**(`Math.round(v/10)*10`,格距 10)。`anchor.x` 已格对齐(`origin.x + col*colWidth`,均为 10 倍数)。格锚点 + 格 local = 格引脚 → offgrid 归零;分数 localBox 仅影响列内间距(无害),不再污染对齐。

- 在 `engine/plexus_planner.mjs` 内加本地 `const GRID=10; const snapGrid = v => Math.round(v/GRID)*GRID;`(保持与生成轨道解耦,不新增 import)。
- 用法:`const anchorY = snapGrid(cursorY); ... fn({ parts, anchor:{x:colX, y:anchorY}, nets })`;游标推进沿用 `cellExtentMinY(...) - rowGap`(下一轮再 snap)。
- `origin.y` 默认 1000(格);若调用方传非格 origin,snap 也会纠正首模块。

## 3. 测试

`engine/plexus_planner.test.mjs` 追加:

- 用**分数 localBox** 的合成件(模拟真实件,如 `localBox.minY=-55.5`)构造 ≥2 个同列 support 模块的 contract,跑 `planLayout`,断言 `model.components` 所有引脚 `x%10===0 && y%10===0`(格对齐),且 `geomQC(model).offgrid===0`。
- 现有 7 个 planner 用例不回归(锚点 snap 对格对齐输入幂等)。
- 全量回归零回归;`npm test` 100/100。

## 4. 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `engine/plexus_planner.mjs` | 改 | 加 `snapGrid`,`anchor.y` 量化到格 |
| `engine/plexus_planner.test.mjs` | 改 | 加分数-localBox 格对齐断言 |

## 5. 验收

- 分数-localBox 合成件:planLayout 产出引脚全格对齐、`geomQC.offgrid===0`。
- 真实 live.json 探针:offgrid 由 68 → 0(交付时手验)。
- 现有套件零回归;`npm test` 100/100。

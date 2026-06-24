# 设计稿:Spec B2a — 真·正交网络路由器(消标签汤,导线为主)

- 日期: 2026-06-24
- 状态: 待用户评审
- 依赖: B1 可信镜头(`twinPredict`/`judgeTokens`,器件几何已 live 钉死);确定性管线(`generateLayout` 入参不可变,已修)。
- 属于: Spec B 第一刀(B2a)。B2b = 引脚邻接紧凑摆放,后续。
- 标准来源: `docs/schematic-design-rules.md`(DR1-3 走线、DR2 异网不交叉)+ `docs/schematic_design_rulebook.md`。
- 工程铁律: `CLAUDE.md`、记忆 `direction-judge-first-3specs`、`label-soup-to-direct-wire`、`eda-authoritative-netlist`。

## 1. 背景与动机

**核心心法(用户 2026-06-24 点透)**:**EDA = Chrome,确定渲染引擎;本工具 = 前端设计工具;一切确定、可精确查询(`getPrimitivesBBox`/`getAllPins`/`getNetlistFile`/DRC 全真值)。绝不靠猜。**

真投递到 EDA 实测(用户揪出):generate 产出是**标签汤**——U/FPC 等每根脚只引短桩→网名标签,模块间**零真导线**,看着全断;DRC 1 error、线端点仅 26% 落脚。根因(已定位):
- `directRouteClose` 太保守:只转**纯 2 脚 + 近 + L 路清**的网,多脚/远/被挡全留标签。
- `connPlace` 按模块粒度排,模块 bbox 被逃逸标签撑大 → 相连脚仍远 → 超距 → 标签。
- 死循环:标签撑大模块 → 排不紧 → 脚远 → 连不上 → 标签。

商用参考(RK806)相反:**真导线为主,标签只给长距/跨区**。B2a 把默认**反过来**:能干净走线就画真导线,连不干净才留标签,且按连通分量留最少标签。

## 2. 目标与非目标

**目标**
1. 新 `engine/net_router.mjs` `routeNets(model, logicalNets, opts)`:对每个**信号网** MST 分解→逐边分级正交路由,**干净的画真 pin-to-pin 导线,不干净的按连通分量留网名标签**;取代 `directRouteClose` 在管线中的位置。
2. **导线占比大幅上升**(对照现状 26% 端点落脚 / 现 directRouteClose 转换率),标签只剩长距/被挡/必交叉网 = 商用式。
3. **零新增几何违规**(T-ORTHO 100%、T-NOCROSS/NOTHRU/NOOVERLAP 不回升)。
4. **绝不断网**:并查集按导线连通分量补最少标签;**真 EDA `getNetlistFile` 权威网表零分裂验证**。
5. 确定性(同输入同输出)+ 不可变。

**非目标**
- 不动摆放(B2b);不路由电源/地(保持 flag/轨商用惯例);不追 DRC 全 0(那是 B2a+B2b 合力,B2a 只担保路由层不引入问题)。
- 不上网格迷宫路由(方案 B,后续若 A 留标签过多再升)。
- 不引入任何"猜":阈值是显式设计旋钮(`maxSpan`/`maxBends`),不是对 EDA 行为的猜测;连通以真网表验证而非假设。

## 3. 核心原则
1. **确定引擎,零猜想**:几何/连通全机械算 + 真 EDA 精确查询验证;变换用已 live 钉死的 `placePin`(脚位)。
2. **绝不断网**:连通性是硬不变量,union-find + 标签保证 + 真网表验证。
3. **宁缺勿乱**:只接受 不穿件体/不跨异网线/不穿异网脚/不重叠/全正交 的路由,否则退标签。
4. **确定性 + 不可变**:同输入同输出;不改调用方数据。
5. **零特定电路内容**:代码/测试全通用;真板几何/网表只进 scratchpad 不入库。

## 4. 架构与接入

| 模块 | 新/改 | 职责 | 依赖 |
|---|---|---|---|
| `engine/net_router.mjs` | **新** | `routeNets(model, logicalNets, opts) → {routed, labeled, stats}`:MST + 分级路由 + union-find 连通保全 | geom 段/障碍原语、`_ax/_ay` 脚位 |
| `engine/cluster_generate.mjs` | 改 | `directRouteClose(out, logical.nets, …)`(:520)→ `routeNets(out, logical.nets, …)`,同位 | net_router |
| `engine/direct_route.mjs` | 弃用 | 标 deprecated(其逻辑 = net_router 的 2脚/L 退化特例) | — |

**边界**:只信号网;电源/地保持现有 flag/轨;摆放不动;在 generate 内部 `out` 模型上操作(沿用现有就地约定),`out` 本就是 generate 私有产物。

## 5. 路由算法(数据流)

`routeNets(model, logicalNets, opts)`:
- 取 `pinPos`(`_ax ?? x`),`obstacles`(件体 bbox),`otherPins`(各脚点);`occupancy`=已布线段(带网名),初始含电源/地等保留线。
- **网排序**:信号网按 MST 总长升序,平局网名 → 确定性。
- **每网**:
  1. **MST**(Prim,曼哈顿)→ 边集。
  2. **逐边分级路由**,接受第一条全干净:**直连 → L(两拐角)→ Z(中线绕,几个偏移)→ 单绕行(绕挡路 bbox 一拐角,有限次)**;`maxBends`≤3、跨度 > `maxSpan` → 该边失败。
  3. **干净判**(每段):正交;不穿件体 bbox(段-矩形相交带边距);不穿异网脚;不跨/不中段触异网 occupancy 线(DR2);不与异网共线重叠。
  4. 成功边:段入 occupancy。
- **连通保全(每网)**:union-find 按成功边合并脚 → 分量。1 分量→删该网全部逃逸标签+桩(全布线);>1 分量→每分量留 1 网名标签、删分量内其余标签;成功边画 pin-to-pin 真导线(到 `_ax/_ay`)。
- 返回 stats:`routedNets/partialNets/labeledOnlyNets/wireEdges/labelComponents`。

**占用/交叉判**:正交段相交 = 一 H 一 V 且区间重叠;同向 = 共线重叠;异网中段相交/触碰即拒,同网端点相接允许。

## 6. 连通性保全与真 EDA 验证(命门)
- union-find 保证**模型内**每网连通(各分量有标签或全布线;绝不出现"0 标签且 >1 分量")。
- **真 EDA 权威验证(控制者跑)**:route→deliver→`getNetlistFile()` → 每信号网脚**零分裂**(同网);+ DRC 不新增错;+ 截图肉眼是真导线。
- deliver 合并同网共线线是良性(连通不变);若网表分裂 = 确定性 bug(多半端点没精确落脚)→ 修,不蒙。

## 7. 错误处理(fail-closed)
- 超 `maxSpan`/`maxBends` → 退标签(非错)。
- 无脚/单脚网 → 跳过;脚位缺 → 跳该边不崩,该脚留标签。
- union-find 异常 → 整网退全标签(安全)。
- 桥/deliver/网表不可用 → 真验证 fail-closed,不声称连通。

## 8. 测试策略(接 `npm test`,零特定电路)
- **net_router 单测**(合成夹具):2脚清路→1线0标签;直/L 挡、Z 通→走 Z;全挡/超 maxSpan→退标签;多脚全清→MST 线 union-find 1 分量 0 标签;多脚 1 边挡→2 分量 2 标签其余布线**连通不变**;交叉避让→输出零异网交叉;不穿件体/异网脚;**确定性**(同输入同输出);**连通不变量**(每网全脚连通)。
- **judgeTokens 集成**:产物喂 judgeTokens → T-ORTHO/NOCROSS/NOTHRU/NOOVERLAP 零回升。
- **真 EDA 验证**:不进 `node --test`,控制者跑 route→deliver→网表零分裂 + DRC + 截图。
- **导线占比指标**:报前后对比 + 对照 RK806(进度量,非门)。

## 9. 验收标准
1. `routeNets` 确定性;只动信号网;电源地不碰;不可变。
2. 产物零新增几何违规(geomQC 交叉/穿越/重叠不升,正交 100%)。
3. 连通不变量对每个网成立(单测证 + 真网表零分裂验)。
4. 导线占比相对现 directRouteClose 大幅上升;标签只剩长距/被挡/必交叉。
5. 真 EDA:路由不新增 DRC 错 + 网表零分裂(截图为真导线);**DRC 全 0 留 B2a+B2b 合力**。
6. `npm test` 全绿;零特定电路;确定性/不可变守住。

## 10. 风险与权衡
- **当前摆放稀疏 → 远网仍多留标签**:B2a 上限受摆放限,B2b 收紧后更多网可路由。B2a 在现摆放下最大化干净导线即达标。
- **`maxSpan`/`maxBends` 标定**:显式旋钮,默认按 RK806 实测线长/拐弯分布定,记录理由,只朝对齐真实调,不为过板放水。
- **deliver 线合并**:同网共线合并良性;以真网表零分裂为准,不以线数为准。
- **多脚 MST vs 总线观感**:B2a 用 MST(简单、连通正确);总线/通道观感(方案 C)后续。

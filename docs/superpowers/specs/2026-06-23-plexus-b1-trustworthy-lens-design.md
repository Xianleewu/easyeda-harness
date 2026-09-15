# 设计稿:Spec B1 — 规则文档锚定的可信镜头

- 日期: 2026-06-23
- 状态: 待用户评审
- 依赖: Spec A(`token_conformance.judgeTokens` 三层确定性裁判,已落地并真机验证读 live 几何)。
- 前置于: Spec B2(连接驱动摆放/密度生成器——把偏差驱到 0)。**B1 不产布局,只让镜头看得见、裁判按规则查得出。**
- 标准来源(唯一真源,不自创): `docs/schematic-design-rules.md`(DR1-18 + "Label Geometry" + "Geometry Audit" 三节)与 `docs/schematic_design_rulebook.md`(设计语言)。本稿每条检查显式引 DR 编号 / rulebook 行号。
- 工程铁律: 见 `CLAUDE.md`、记忆 `design-token-conformance-not-imagination`、`eda-real-screenshot-and-layout-redesign`、`eda-digital-twin`。

## 1. 背景与动机(为什么先做镜头、为什么要重锚)

工程一个月没做好的**总根子**(用户 2026-06-23 点破):**我们一直在优化一个谎言。** 流程是 `generateLayout` 产模型 → `sheet_renderer` 离线画 → 看这张画判好坏 → 调参。但 `sheet_renderer` 画的是它自己风格的「框 + 桩 + 网名标签」,EDA 画的是**真符号 + 真走线 + EDA 自己的放置变换(旋转 CCW / 镜像翻 X)**——两者相似度≈0。对着离线图调得再"好看",投到 EDA 还是另一副样子。**在沙子上盖楼,必塌。**

第二层根子:我把 Spec A 实现的裁判当成了"全部标准",但它只是 DR1-18 的**子集**,而且连实现的重叠检查都**违反 DR4**(只算器件+netflag bbox,漏了 text/attribute)。**真正的标准写死在规则文档里**,我没拿它当锚,又凭子集臆想——违反铁律"消灭 AI 自我想象、机械符合写死的规则"。

结论:**先造一面【规则文档锚定的可信镜头】**——它(a)忠实预测/捕获 EDA 实貌,(b)按规则文档审一切该审的几何(尤其我漏掉的 DR4/DR5 全可见对象重叠、DR11-16 扇出对齐),(c)用真 EDA 钉死可信度。镜头不可信、不全,B2 的摆放就是继续盲调,必然重蹈覆辙。

## 2. 目标与非目标

**目标**
1. **忠实数字孪生 `twinPredict(model, snapshot)`**:对任意候选布局,预测它在 EDA 的真实几何——器件 bbox 按放置(rot/mirror)**重算**、脚位、**以及标号/阻值文字 + GND/NC/netflag + wire `Name` 的位置与 bbox**(规则文档 "Geometry Audit" 节要求审的全部可见对象)。输出与 `readGeometry` 同形,直接喂 `judgeTokens`。
2. **几何裁判补全到规则**(扩 `geom_qc` + token,显式引 DR):
   - **DR4/DR5**:重叠检查纳入 text/attribute/GND/NC/netflag/wire-Name bbox —— 任何可见对象互不重叠、且不压器件本体(治"标号压标号/标号压线/标号压体")。
   - **DR11/12/13/16**:同侧扇出标签对齐 —— 共列 `x`(容差内)、左 `alignMode=8`/`RIGHT_BOTTOM`、右 `alignMode=6`/`LEFT_BOTTOM`，文字朝模块外展开，原点落对应底角，行距可读不糊。**注:B1 的 `T-LABEL-ALIGN` 是【经验几何判】(同侧标签实际是否共 x / alignMode / 原点角 / 行距,无需 `layoutPolicy`);"是否匹配【声明的】label-column"(DR8/8A/13-声明/14/15)依赖 `layoutPolicy`=生成器产物,留 B2。**
   - rulebook 行 159(异网端点/重叠接触=0)、行 166(文字压线/压体=hard)纳入。
3. **可信镜头预览 `twin_renderer`**:把 twin 几何忠实渲染(真 bbox + 真脚 + 文字位 + 线),**取代 `sheet_renderer` 当质量预览**(符号美术可不画,几何占位/重叠/对齐忠实)。
4. **真 EDA 标定 `twin_calibrate`**:证明 `twinPredict` 预测 ≈ 真 EDA(含文字落点),否则镜头标"未钉死,不可信",禁 B2 用。
5. **薄真闭环 `live_loop`**:备份→deliver→观测(judge)→可还原,安全可重复,供标定与 B2 复用。

**非目标(明确划走)**
- 不"把布局**变规整/变密**"——那是 B2(连接驱动摆放/密度/标签转直连)。B1 只让镜头看得见、裁判查得出偏差。
- 不实现 DR6-8(模块矩形/flow/label-budget):依赖 `layoutPolicy`(生成器产物),与 B2 同期。
- 不处理**新建器件**(无快照本地几何真源):B1 只重排快照内已有器件;端到端新建需符号库,后续。
- 不出任何百分比/合成分(沿用 Spec A)。

## 3. 核心原则(不可违背)

1. **标准 = 规则文档,不自创**:每条检查引 DR 编号 / rulebook 行号;严标值取 DR(如 DR1 正交 100%);RK3576 实测只填 DR 未量化处(密度/标注丰富度),绝不为过板放水。
2. **离线渲染永久退出"质量裁判"**:`sheet_renderer` 顶多结构 sanity,绝不作好坏依据。**唯一可信信号 = 真实 EDA**(`readGeometry` + `sch_Drc.check` + 真截图)或**被真图钉死的孪生**。
3. **能机械判的绝不靠想象**:bbox/脚位/重叠/对齐全几何机械判;变换数学由实测推导(沿用 `eda_transform` 实测法),严禁猜测。
4. **fail-closed**:桥/读几何/DRC/截图不可用,或标定误差超 tol,或孪生未钉死 → 绝不默认可信/通过。
5. **零特定电路内容**:镜头/裁判/标定全通用;具体板的几何/截图只进 scratchpad,绝不入库。

## 4. 架构与模块

| 模块 | 新/改 | 职责(单一) | 依赖 |
|---|---|---|---|
| `engine/eda_transform.mjs` | 改 | 已有脚位变换(实测 CCW/镜像翻 X);**补 bbox 变换** `placeBBox(localBBox,ox,oy,rot,mirror)` + `inverseBBox`(从快照反解本地 bbox)。正交+镜像保矩形轴对齐 → 变换对角两角取 min/max。 | 无 |
| `engine/eda_twin.mjs` | **新** | `twinPredict(model, snapshot)`:逐器件按 `(x,y,rot,mirror)` 重算 bbox/脚位 + **标号/阻值文字位与 bbox + GND/NC/netflag bbox**;产出与 `readGeometry` 同形几何。 | eda_transform |
| `engine/geom_qc.mjs` | 改 | 重叠纳入 text/attribute/flag/NC/wire-Name bbox(**DR4/DR5**);异网接触=0(rulebook 159);文字压线/压体=hard(rulebook 166)。 | 无 |
| `engine/token_conformance.mjs` | 改 | `T-NOOVERLAP` 实现补全到 DR4/DR5;**新增 `T-LABEL-ALIGN`**(DR11/12/13/16:同侧共列 x / alignMode / 原点角 / 行距)。 | geom_qc, design_tokens |
| `engine/design_tokens.mjs` | 改 | 补 `T-LABEL-ALIGN` token(源 DR11-16);`T-NOOVERLAP` desc 显式覆盖 text/attr。 | 无 |
| `engine/twin_renderer.mjs` | **新** | 忠实渲染 twin 几何(真 bbox+脚+文字位+线),取代 sheet_renderer 当预览。 | eda_twin |
| `engine/twin_calibrate.mjs` | **新** | Level1 变换 8 态验证 + Level2 端到端(deliver→read→对照,含文字落点 + tier2 偏离数一致性);fail-closed。 | live_loop, eda_twin, geom_qc |
| `engine/live_loop.mjs` | **新(薄)** | preflight 守门→备份→deliver→观测(runLiveJudge)→可还原(校验式)。 | deliverGenerated, runLiveJudge, bridge_windows |
| `engine/bridge_windows.mjs` | 改 | `readGeometry` 的 `SNAPSHOT_CODE` 补抓 **attribute bbox**(EDA 给不了则按字串长×字号估算,标定钉死);补 wire `Name`/netflag/NC bbox。 | bridge |
| `bin/plexus.mjs` | 改 | `twin <snap> [out.png]`(离线忠实预览 + 离线 judgeTokens);`calibrate --live`;`loop --live`。 | 上述 |

## 5. `twinPredict` 数据流(核心)

`twinPredict(model, snapshot)`,按 designator 配对 model 件 `c` 与 snapshot 件 `s`:

```
① 反解本地几何(实测变换的逆,本地=rot0/mirror-false/相对原点):
   localPins[num] = localOffset(s.pin.x, s.pin.y, s.x,s.y, s.rotation, s.mirror)   // eda_transform 已有
   localBBox      = inverseBBox(s.bbox,    s.x,s.y, s.rotation, s.mirror)          // 本稿补
   localAttr[k]   = localOffset(s.attr.x,  s.attr.y, s.x,s.y, s.rotation, s.mirror) + 文字 bbox 反解
② 按 model 新放置正算:
   pred.pins[num] = placePin(localPins[num], c.x,c.y, c.rotation, c.mirror)
   pred.bbox      = placeBBox(localBBox,     c.x,c.y, c.rotation, c.mirror)        // 治"旋转后 bbox 没重算"
   pred.attrs[k]  = placePin(localAttr[k], …) + 文字 bbox 随放置变换
③ 产出件 = {designator, x,y, rotation, mirror, bbox:pred.bbox, pins:pred.pins, attrs:pred.attrs(含 bbox)}
```

- `wires/rectangles` 坐标全局,EDA 原样画 → 直通;`netflags/NC` 按其放置预测 bbox。
- **输出形态 = `readGeometry` 同形** → `judgeTokens(twinPredict(...))` 原样跑。
- **tier2 几何 token 离线可忠实预测**(正交/栅格/交叉/穿越/重叠含文字/密度/标注/对齐);**tier1 DRC 离线不可预测 → 诚实标"需 live"**,不假装。
- 边界:model 件不在 snapshot(无本地几何)→ 标"不可预测"→ 整 twin 失败(不瞎猜)。

## 6. 标定(钉死孪生,反 gaming)

**绝不只预测原板自己**(逆→正=恒等的循环自证)。两级:

- **Level 1 变换数学验证**:取样本器件,真 EDA 逐帧摆到 0/90/180/270 ×{镜像,不镜像}共 8 态,`readGeometry` 读回真 bbox/脚位/文字位,对 `placeBBox/placePin` 预测。正交变换下应精确。验完还原。沿用 `eda_transform` 当年验脚位同法。
- **Level 2 端到端(决定性)**:`备份→deliver 候选(新放置)→ readGeometry+judgeTokens(真) → 对照 twinPredict+judgeTokens(孪生) → 还原`。两对照:① 逐件 `|预测 − 真|` 的 bbox 角/脚/**文字位**最大误差;② **每条 tier2 token 偏离数 孪生 vs 真 差**。

**通过判据(严)**:`maxPinErr ≤ tol`(期望≈0);`maxBBoxErr(符号本体)≤ tol`(期望≈0,正交刚体);**每条 tier2 偏离数差 = 0**(理想)或显式记残差+原因。

**已知坑挑明(不臆断,由标定测定)**:EDA 的**器件 primitive bbox 是否含标号/阻值文字、旋转时文字是否非刚体重排**——**不假设,Level1 标定直接测**。无论结论如何,twin 的处理固定为:**符号本体 bbox**(=器件 primitive bbox,刚体精确)用于密度/重叠的本体判;**标号/阻值文字 bbox 作为独立可见对象单独预测 + 单独标定**(若标定发现 EDA 自动重排文字 → 暴露为残差,对策"投递时确定性设文字位"留 B2)。标定报告把"文字位残差"列为已知项,且**文字重叠(DR4)按独立文字 bbox 判,不依赖器件 bbox 是否含文字**。

**产出**(scratchpad,不入库):标定报告 JSON(maxPinErr/maxBBoxErr/逐 token 偏离数对照/verdict)+ **孪生渲染 vs 真截图并排图**(肉眼最终确认)。**失败 → 孪生标"未钉死",fail-closed。**

## 7. `live_loop`(薄,安全第一)

血泪教训(误投毁用户板,记忆 `never-deliver-demo-to-user-board`)定死安全第一:

```
preflight 守门 → 备份 → deliver → 观测(judge) → 可选还原(校验式)
```

- **preflight**:投递前读目标板 designator;**非 `--confirm-overwrite` 一律拒投**;识别"像真实设计"的板要再确认。
- **备份**:投递前完整快照写 scratchpad(时间戳);任何修改前必有备份。
- **deliver**:复用 `deliverGenerated(model)`。
- **观测**:复用 `runLiveJudge`(读真几何 + DRC + 截图)→ 真 tier1+tier2。
- **还原(`--restore`)**:重放备份;还原后**重读校验 ≈ 备份**,不一致 → 大声报错 + 指向备份文件,**绝不静默**。

## 8. 错误处理(全程 fail-closed)

| 情形 | 处理 |
|---|---|
| 桥/读几何/DRC/截图 不可用 | 操作 fail-closed,绝不静默成功 |
| `twinPredict` 遇模型件不在快照 | 标"不可预测"→ 整 twin 失败,不瞎猜 |
| 标定误差超 tol / tier2 偏离数对不上 | 孪生标"未钉死,不可信",禁 B2 用 |
| `live_loop` 无 `--confirm-overwrite` | 拒投 |
| 还原校验不过 | 大声报错 + 备份路径,提示板可能被改 |

## 9. 测试策略(接现有 `npm test`,零特定电路)

- **`eda_transform` bbox 新增**:纯单测。8 朝向 `placeBBox/inverseBBox` 往返=恒等;定向夹具(10×20 本地 bbox 经 rot90 → 宽高互换 20×10);镜像翻 X。
- **`eda_twin.twinPredict`**:合成 model+snapshot 夹具(通用)。断言①输出与 `readGeometry` 同形;②**旋转件 bbox 被重算**(rot90 件 bbox 维度交换);③脚位经 eda_transform;④**文字位/ bbox 随放置变换**;⑤`judgeTokens` 能直接跑;⑥缺快照件 → 失败。
- **`geom_qc` / `T-NOOVERLAP` 扩展**:夹具断言文字-文字、文字-体、文字-异网线 重叠被检出(DR4/DR5/rulebook166);异网接触=0(159)。
- **`T-LABEL-ALIGN`**:夹具断言同侧不共列 x → 偏离;alignMode 错 → 偏离;行距糊 → 偏离;规整对齐 → 符合(DR11/12/13/16)。
- **`twin_calibrate`**:**对照逻辑**(给两份几何 → maxErr/逐 token 偏离数差 → 通过/失败)用夹具单测;live 投递/读**不进** `node --test`(需桥),由控制者执行;fail-closed 路径用守卫测。
- **`live_loop`**:安全逻辑单测(无 `--confirm-overwrite` 拒投;deliver 前必写备份;还原校验不过即抛)用 mock 桥。
- **`twin_renderer`**:冒烟(能出图、尺寸对)。
- 全新文件跑**零特定电路字面量扫描**。

## 10. 验收标准

1. `twinPredict(model, snapshot)` 产出与 `readGeometry` 同形,且**旋转/镜像件 bbox、脚位、标号/阻值文字位全按放置重算**;`judgeTokens` 直接可跑;缺快照件 fail-closed。
2. `geom_qc`/`T-NOOVERLAP` 按 **DR4/DR5** 把 text/attribute/flag/NC/wire-Name 纳入重叠;`T-LABEL-ALIGN` 按 **DR11/12/13/16** 判同侧扇出对齐。每条检查代码注释引 DR/rulebook 行号。
3. `twin_calibrate` 在真 EDA 上对孪生**钉死或诚实判未钉死**:报 maxPinErr/maxBBoxErr/逐 token 偏离数对照 + 并排图;误差超 tol → fail-closed。
4. `live_loop` 安全:无 `--confirm-overwrite` 拒投;必有备份;还原校验式。
5. `sheet_renderer` 不再被任何质量判定引用(降级为结构 sanity)。
6. `npm test` 全绿(原有 + 新增);fail-closed 路径有覆盖;零特定电路字面量。

## 11. 风险与权衡

- **EDA 自动重排标注文字**:若旋转时 EDA 非刚体移动标号/阻值,孪生文字位预测有残差 → 标定暴露;对策是投递时确定性设文字位(本稿镜头先暴露,设位本身可在 B2)。
- **attribute bbox 真源**:EDA 若不给 attr bbox,按字串长×字号估算 → 标定钉死估算公式;估算不准则 fail-closed 标残差。
- **范围比初版大**(含几何裁判补全):但这是 honor 写死规则的必然代价;DR6-8/变规整 已明确划到 B2,B1 边界清晰(几何/重叠/对齐**可见性 + 可判性**,不含布局生产)。
- **标定需一次 deliver(毁板)**:由 `live_loop` 备份/还原 + `--confirm-overwrite` 控,且只需偶发校验,不进自动测试。

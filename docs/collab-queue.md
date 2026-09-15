# 双 Agent 协作队列（Claude × Codex）

> 通信信道：本仓库 = 消息总线（AGENTS.md 收件箱 / review 裁定指令 / 附录 B 回执 / 本队列分工）。
> 实时通道（可选）：codex 跑进命名 zellij 会话后可被 write-chars 直发。
> **强制力（2026-09-15 16:55 起）**：本文件已加入 `workflow_receipt.mjs` 的 `REQUIRED_RULE_FILES`——
> 队列一变，所有在途回执即失效，下一次写入被 fail-closed 拦截，必须重跑 `wf check` 重读本队列。
> agent 接到任何 live 写入被"rule changed: docs/collab-queue.md"拒绝时，第一动作 = 读本队列最新内容。
> 规则：认领 = 把 owner 改成自己；完成 = 状态改 done + 填证据路径；禁止认领他人 doing 条目。
> 优先级以 `docs/workflow-review-2026-09-15.md` 为准，本文件只管"谁在干什么"，不复述规则。

## 迭代完成定义（DoD，全勾即本迭代收口）

- [x] P0 judge 基础清单全绿（wire 穿可见文字全量 / per-side 标签锚点 / live 与 model 同等完整）；目审反推的 Q9 三项也已落成独立 token
- [x] P1-4 候选写前全量裁判全路径强制，并经独立验收（Q1）
- [ ] 当前板全绿：源断言 + 原生 DRC 0/0/0/0 + 权威网表对账 0 mismatch + 一次新整页截图
- [ ] 附录 B 重复纠正计数停止增长

## 工作队列

| ID | 工作项 | 轨道 | owner | 状态 | 证据/交接物 |
|---|---|---|---|---|---|
| Q1 | 独立验收 codex 落地的候选写前门禁（读 `engine/workflow_receipt.mjs` / `candidate_preflight.mjs` / `source_candidate_twin.mjs` + 测试，构造红候选实测写前被拒） | verify | claude | done | **通过（附 1 项需澄清）**。证据：①`node --test` 三模块 8/8 绿；②`srccommit.mjs` 写序核验=回执校验(38)→A1-A10(52/70)→候选全量裁判(75-82，红即 throw 于 `setDocumentSource`(85) 之前)；③`commercial_judge.mjs:94` 证实 `runLiveJudge` 未传 `verifiedDrc` 时自跑 DRC，beforeGate 有真 DRC 证据。**遗留**：活动页 DRC 为红时 repair 提交被 `candidate_preflight.mjs:86` 硬拒（"Baseline native DRC is not verified clean"），与 SOP 红页修复棘轮冲突——DRC 红页当前无任何写路径（潜在死锁），需 codex 澄清是否有意为之 |
| Q2 | P0 detector：wire 穿可见文字全量判定（T-NOTHRU-TEXT） | engine | codex | done | 可见器件标注、信号标签和电源/地名称均进入 bbox 线穿检查；自身连线不豁免；model/live 共用裁判，正反回归已纳入全套测试 |
| Q3 | P0 detector：per-side 标签锚点（同侧端点共享视觉轴） | engine | codex | done | `T-LABEL-ALIGN` 从自由端导线几何判左右，强制 LEFT_BOTTOM/RIGHT_BOTTOM 与列轴；`T-FLAG-ALIGN` 按同件同侧分组，相关 live identity lint 已通过 |
| Q4 | live judge 与 model 同等完整（`getNetlistFile` 网表证据强制，缺数据=检查器缺陷） | engine | codex | done | live 固定 `requireNetlistEvidence=true`；网表缺失时 `T-ADJACENCY` 只报一个 `missing-authoritative-netlist` 根因并给出重新取证 recipe，禁止 skip-as-pass |
| Q5 | P2 参数化单元原语（角色命名的高层操作 → 编译成 recs） | engine | 待认领 | todo | |
| Q6 | 当前板按 judge 清单分模块修复 | live | codex | doing | 2026-09-16 新 Q9 门禁 identity lint：源断言 0、DRC 0/0/0、26/26 token 覆盖；`T-LABEL-CROWD` 与 `T-ORPHAN` 通过，`T-ANNOT-SIDE` 精确报 3 件位号/型号分列上下两侧。下一批按这 3 个对象一次性修复后再 audit；当前状态不得宣布完成 |
| Q7 | **快路径 `wf quick`（最高优先）**：小板专用直达轨 = 引擎构造式布局（`cluster_generate`/`module_repack` 现成件）→ 离线候选 preflight（今日 Q1 已验收的门禁，即快路径的刹车）→ 单次 `wf commit` 写入 → 单次 `wf audit`。无修复循环。**KPI=skill 验收标准：≤25 件板，零细节沟通，≤2 次 live 写入，≤15 分钟，audit 全绿** | engine+live | 待认领 | todo | |
| Q8 | **skill 装订**：把方法层打包成薄 skill（`.claude/skills/` SKILL.md + AGENTS.md 指针），内容=档位决策（quick/重棘轮）+ agent 每轮动作协议 + 唯一合法板级输入（模块/子区声明）。规则本体不复制——机器即规则，skill 只讲方法 | engine | claude | todo | |
| Q9 | **P0 detector 三连（Q6 目审打回的直接反推）**：①T-LABEL-CROWD——扇出标签列内文字互叠/贴线（P2 实证）②T-ANNOT-SIDE——同器件位号/值标注同侧一致性（U1 周边实证）③T-ORPHAN——无功能归属的孤立件（D1 实证）。验收=各自在当前板复现真实缺陷并定位到对象/坐标 | engine | codex | done | 三项均为 token registry 中的独立 tier2 detector：标签 bbox/导线定位；所有装配件含多引脚器件逐件同侧；每件在 module/cell 中各恰好一次。单测含正反例；live identity lint 26/26，真实命中 `T-ANNOT-SIDE` 3 项，另外两项在当前已修状态为绿 |
| Q10 | **标签锚点约定翻转落地（用户 2026-09-15 裁定，文档已翻）**：`token_conformance.mjs` / `source_label_origin.mjs` 执行常量翻转 + 关联测试同步 + `assert_source` A6 空 align soft→hard | engine | **codex 实现 + claude 验收** | **done（2026-09-15 17:30）** | 时间线：claude 17:05 翻文档 → codex 17:08 被回执强制重读 → 17:15–17:23 完成代码+测试翻转 → claude 验收 **104/104 测试绿**、A6 已 hard（`assert_source.mjs:79`）。**下游硬状态**：当前板 38 个 null align + 左半边混用列 → A6(hard) + 翻转后 T-LABEL-ALIGN + bad-alignmode 三重拦截，**任何 commit 都会失败**——唯一前进路径 = Q9 三 detector → 按新约定一次性标签批次（全 NET 标签落 align+锚点外缘列）。下一个检查点（claude 盯）：下一次 judge 在当前板上必须报红，红=新尺子咬住了 |
| Q11 | 电源/地旗标完整几何：方向、符号 bbox、唯一可见网名、横向名称轴线居中、旗标与端接短桩相对方向 | engine | codex | done | `T-FLAG-ORIENT` 检查真实 rotation/name bbox/stub；`T-NOOVERLAP` 包含 flag bbox；A6f 禁止双重可见名称；左右电源名称强制 MIDDLE 对齐；相关单测和一次完整 live 复读通过 |
| Q12 | **黄金标定夹具（"一切都反了"的根治）**：把用户验收过/手改过的真板几何冻结为 calibration fixture（仓库外私有目录），T-LABEL-ALIGN / T-FLAG-ORIENT / T-ANNOT-SIDE 等一切"约定类" detector 必须对它 PASS 才算约定编码正确。此后任何约定改动都要过这个夹具=用户的眼睛被永久编码 | engine | claude | todo | |
| Q13 | **`wf lint` 秒级只读前门（产品转折点）**：一次读取源/几何/权威网表/绑定封装并运行原生 DRC + 全量 token，输出根因队列且不截图、不写画布；成功后产生限时写前回执。验收：任意已绑定证据的打开文档 <10s 出清单 | engine | codex | done | 实测 1.4–1.7s；无环境变量时从活动文档绑定的回执+上下文恢复私有 evidence 路径，文档或路径不一致 fail-closed；当前图输出 26/26 和 3 个可定位标注侧别问题 |
| Q14 | **asc 黄金样例 + 解析器（用户提议）**：`examples/` 自绘通用范式电路 `.asc`（buck/MCU 去耦组/USB 接口，规避 LTspice/AD 官方示例版权）+ `engine/asc_parse.mjs`（SYMBOL/WIRE/FLAG/TEXT → model）+ 标定报告（人工好图上跑 judge，约定类 detector 必须 PASS）+ README before/after 展示图。远期=asc→EasyEDA 导入入口。示例=数据非逻辑，引擎零特定内容 | engine | 待认领 | todo | |

## 轨道定义（冲突隔离）

- **engine**：纯离线代码+测试，不碰 live 文档、不调 bridge——与 live 轨零冲突。
- **live**：唯一允许写 live 文档的轨道（`wf commit`），同一时刻只允许一个 owner。
- **verify**：只读验收（跑 judge / 测试 / 读证据），不写引擎、不写 live；验收结论回写本队列。

## 交接协议

1. engine/live 交付 → 在本队列填证据路径 → verify 认领验收 → 验收结论（通过/打回+理由）回写。
2. 打回的条目回到原 owner，带打回理由，不允许无新证据重提同型候选。
3. 本文件冲突（双方同时改）：后写者重读再合并，队列条目按 ID 幂等。
4. **标准工作流 = compile-first（2026-09-15 用户裁定，AGENTS 契约已同步）**：写/改变换后先跑
   `node compile.mjs <变换>`（秒级离线全栈：变换→编译→断言→twin→token→delivery，输出全量
   缺陷清单带坐标 + 写前门禁判决），**绿且偏离严格下降**才 `wf check` → `wf commit`。
   禁止用 wf commit 发现候选缺陷；禁止试错穷举候选。
   **codex 立即行动**：`normalize-label-anchors.mjs` 已被 compile.mjs 判红（448ms）——
   A6d/A6e 电源旗标网名 2 项硬断言 + 修复队列 4 类 26 项（T-FLAG-ORIENT×22 /
   T-TEXT-OVERLAP×2 / T-MODULE-SPACING×1 / T-CELL-SPACING×1，0→26 无严格改进）。
   把旗标网名可见且水平、interface-power 间距≥60、input-protection×conversion 不重叠
   **并入同一批次**，compile 秒验到绿，再 wf check → wf commit。
5. 稳定窗口说明：第 4 条 + AGENTS compile-first 段为**用户指令的一次性破例广播**（此后 claude
   恢复冻结到窗口结束）；codex 重跑一次 wf check 刷新回执即可继续。
6. **重定基线令（2026-09-16 00:05，claude 实测）**：裁判连夜变严（Q11/pin-semantics/highspeed
   新 detector），旧变换全部过期——**丢弃 normalize-label-anchors.mjs（对旧基线写的）**。当前板
   真实存量 = 空变换基线实测：**硬断言 4（A6c/A6d×5/A6e×2/A6f×6）+ 9 类 257 项**，其中
   **T-PIN-SEMANTICS×113 + T-HIGHSPEED×36 主因 = CN1 封装/库断绑**。行动序：
   ①CN1 库绑定收口（你正在做的 materialize/bind/restore 即此项，**每步落地必须在队列登记**，
   7h 零汇报=违约，再犯 claude 接管）→ 库修复后立即跑 identity compile 重测，113+36 应归零
   ②A6c-f 硬断言批（电源网名可见/水平/去重）③旗标/标签/间距几何批（T-NOTHRU×7、
   T-TEXT-OVERLAP×2、T-MODULE-SPACING、T-FLAG-ORIENT 等）。每批 compile 秒验 → 绿 →
   wf check → wf commit → 队列登记偏离变化。**此后任何 detector 落地后第一动作 = identity
   基线重测**（新尺子必须先重定基线再写修复）。

# Live Schematic Optimizer 设计稿

- 日期: 2026-06-17
- 状态: 待用户评审
- 关联: `live:audit`(已落地)、`bin/easyeda-plexus.mjs`、`engine/bridge_client.mjs`、`engine/apply_gated.mjs`、`engine/layout_planner.mjs`

## 1. 背景与目标

工具的产品形态:用户装好后跑类 brainstorming 的 `/xxxx` 前门 → 问设计意图 → 出方案 →
去 EasyEDA 选器件 → 中间交互 → 生成。两个旁路入口:① 客户已在原理图里放好器件选型;
② 直接对一张已有原理图做完善优化。**vibe-buddy 是入口 ② 的实测对象。**

本设计聚焦入口 ②:把一张已连接的真实原理图,从 `live:audit` 报告的不就绪状态,
通用、可复用、每步验证地推到 **DRC 0/0/0/0 + 商业级布局**。

当前 vibe-buddy 真实地基(live 验证):DRC 0/0/106/82;器件标准化 74、悬空引脚 13、
残留网标 3;视觉:线压器件 58、标签问题 5、重叠 0、异网交叉 0。

### 关键定性

1234 不是 4 个孤立修补,而是 **3 个产品能力 + 1 个前门**,且底层 API 原语大多已存在:

| 审计项 | 产品身份 | 现有原语 |
|---|---|---|
| ①器件标准化(74) | "去 EDA 选器件"后半段 | `eda.lib_Device.search`(已用于 `apply_full.mjs`) |
| ②悬空引脚(13) | "中间交互"的连接意图判定 | `noConnects` 一等概念;`eda.sch_PrimitiveWire` 补线 |
| ③残留网标(3) | 安全清理 | `eda.sch_PrimitiveText` + gated apply |
| ④商业级布局 | "排得精美"的 R&D | `layout_planner.mjs`/`layout_worker.mjs` 骨架 |

**结论:不缺"能不能写"(API 全通),缺"谁来决定写什么"——即"中间交互"。**

## 2. 用户已拍板的三个岔路口

1. **起步顺序**: 两条并行推进(DRC 归零 + 商业级布局;布局是 R&D,增量交付、较慢)。
2. **交互模型**: 混合——可自动判定的自动改,只把模糊项(选哪颗 LCSC、漏连 vs NC)交互式问。
3. **实时写授权**: 授权写 vibe-buddy 实时图,但每步 gated + 改后复跑 `live:audit` + 可撤销,分批做。

## 3. 架构

入口: 新增 `node bin/easyeda-plexus.mjs optimize`(将来 `/xxxx` 前门的"优化已有图"分支路由到此)。
对任意已连接原理图通用,复用 `live:audit` 的既有 finding 分类。一个主循环驱动两个子系统,
全程经现有 **fail-closed gated 写路径**,零低层 writer 绕过(守 AGENTS.md 第 8/19 条)。

```
optimize_loop.mjs  主编排
  └─ live:audit → finding_classifier → {auto 自动改 | ask 问模糊项} → gated apply → 复跑 audit → 循环
```

### 3.1 子系统 A — DRC 归零修复环(确定性 + 混合交互,快)

| 模块 | 职责 | 可测性 |
|---|---|---|
| `engine/finding_classifier.mjs` | 纯函数:输入 live_audit findings + live 快照,逐条判 `{auto\|ask\|skip}` + 理由 | 纯函数,单测 |
| `engine/resolvers/device_std.mjs` | ①74:按现有属性/封装 `lib_Device.search`;唯一命中→自动重绑;多/零命中→ask | 纯判定可测,落地走 gated |
| `engine/resolvers/net_label.mjs` | ③3:残留未连网标→自动删(安全) | 单测 |
| `engine/resolvers/floating_pin.mjs` | ②13:结构启发式→明确 NC 自动加非连接标识;有漏连风险(R9.2/R11.2/R13.2/C13…)→ask | 启发式单测 |
| `engine/interaction.mjs` | 混合:会话内 AskUserQuestion 逐项问;无人值守时写 `optimize_decisions.json` 让用户填(复用 repair_actions/next_actions 模式,可审计) | 契约测试 |

落地: 每批 ask+auto 结果 → 生成 gated action → `apply_gated.mjs` 写 → 复跑 `live:audit` →
记 `optimize_undo.json` 撤销日志。终态: DRC 0/0/0/0。

### 3.2 子系统 B — 商业级布局(增量 R&D,并行第二轨)

扩展 `layout_planner.mjs`/`layout_worker.mjs`,最便宜高收益优先,分步:

- **Pass 1 局部可读性**: 标签避让(5 处 label issue)+ 穿线局部重绕(58 处 wire-through-component)。
- **Pass 2 模块整列**: 按 `layoutPolicy` 把模块对齐到有序列。
- **Pass 3 整图重排 + 正交自动布线**: 最大 R&D。

每 Pass 同样 gated + 复跑 `readability` 指标。诚实预期: A 这轮即可把 DRC 推到接近 0;
B 增量交付,布局求解进展较慢。

### 3.3 并行落地

"两条并行"用并行子 agent 实现: A 的 resolver 与 B 的 Pass 互相独立 → 并行建,各自带测试
(符合 agents.md 的并行 Task 规则)。

## 4. 数据流与契约

- 输入: `live_audit_report.json`(findings + readability)+ live 快照(`full_model.json`/实时拉取)。
- 中间: `optimize_decisions.json`(待决项,可审计)、`optimize_plan.json`(本批 action)。
- 输出: gated apply 写回实时图 + `optimize_undo.json` + 复跑后的新 `live_audit_report.json`。
- 所有写经 `apply_gated.mjs`;桥经 `bridge_client.executeCode`(已存在)。

## 5. 错误处理与可逆

- 桥不通: 复用 `bridge_check` 的 fail-closed 指引,绝不深处抛栈。
- 每批前快照、每批后复跑 `live:audit`;若复跑指标变差 → 自动停 + 提示用基于 `optimize_undo.json` 回滚。
- 模糊项绝不自动猜:无唯一判定一律进 `ask`。

## 6. 测试

- 分类器/resolver 是纯函数 → TDD 先红后绿,覆盖 auto/ask/skip 三态与边界(零命中、多命中、漏连风险)。
- 端到端冒烟: 用本地样例(`examples:divider`)+ live 快照夹具验证一轮 audit→plan→(dry-run)apply→复跑。
- 实时写: 桥连通后,小批量(先 ③ 残留网标 3 项,最安全)做首批真实写验证可逆。

## 7. 非目标 / 风险

- 不替用户做 BOM 决策、不替用户判漏连——一律交互浮出。
- 商业级布局(Pass 3)是开放 R&D,本设计不承诺一蹴而就。
- 不引入低层 writer 绕过 gate;不破坏现有 fail-closed 契约。

## 8. 实施排程

- 本会话: 建 A 的分类器 + resolver + interaction + gated 接线 + 单测(读路径与判定先行,实时写等逐批授权);并行起 B Pass 1。
- 桥已连通后: 跑 `optimize` 首批真实写(从最安全的 ③ 开始),逐项推进到 0/0/0/0 + 布局美化。

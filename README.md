# EasyEDA Harness

[English](README.en.md)

EasyEDA Harness 是一套给 Codex、Claude Code 等编程 Agent 使用的原理图生成与校验工具。它不是 EasyEDA API skill；官方 `easyeda-api-skill` 负责 API 文档、Bridge 和 EasyEDA 扩展，本仓库负责确定性铺图、质量检查、离线预览、真实 EDA 快照证据和写回闭环。

用户最简单的用法是：把这个仓库交给 Agent，并要求它按 `AGENTS.md` 或 `CLAUDE.md` 执行。Agent 应自动安装依赖、确认官方 EasyEDA API Skill/Bridge、运行门禁、生成截图证据，并在 PASS 后再写回 EasyEDA。

中立工作流入口是 `node bin/easyeda-gsd.mjs`；Agent 规则见 `docs/agent-runner-guide.md`。

## 适用边界

这个仓库是可执行工作流，不是让 Agent 在 EasyEDA 里自由画图的提示词集合。用于新项目时，Agent 必须先建立项目级合同：功能模块、引脚、关键网络、模块矩形空间、允许的符号和截图验收区域；然后再实现或修改确定性模板和规则。

当前模型 PASS 只证明当前模型 PASS，不能证明其它项目、其它原理图或手工绘制结果符合规则。

`project_spec.json` 是用户电路需求的机器输入；`node bin/easyeda-gsd.mjs plan` 会写出 `gsd_plan_report.json`，证明 spec 已经被当前合同、网表、装配和电路包兑现；`node bin/easyeda-gsd.mjs generate` 会写出 `gsd_generate_report.json`，并在 plan 失败时拒绝生成；`project_contract.json` 是 Agent 从 spec 落下来的设计合同；`project_assembly.json` 把每个合同模块映射到确定性 cell、refs、anchors、nets 和布局策略。`npm run spec` 会检查 spec 已被 contract 覆盖，`npm run contract:assembly`、`npm run contract:layout` 和 `npm run accept` 会继续检查合同、装配清单、布局策略与模型。
`npm run spec:schema` 会先验证 spec 自身结构，再进入合同覆盖检查。

`project_contract.json` 是 Agent 接手新项目时必须先修改的机器合同，`project_netlist.json` 记录关键网络的必连端点，`circuit_packs/*/cell_manifest.json` 声明所选电路包的确定性 cell 能力，`project_assembly.json` 是随后必须补齐的可执行装配映射和布局策略。`npm run contract`、`npm run contract:netlist`、`npm run contract:cells`、`npm run contract:assembly`、`npm run contract:layout` 和 `npm run accept` 会检查这些文件；未通过时，不应继续写回或声称已完成。
`circuit_packs/*/pack.mjs` 承载电路族行为，例如 cell builders、fallback anchors 和器件库快照归一化；`npm run contract:pack` 会在生成前校验所选 pack。

## 核心能力

- 确定性原理图组装：`engine/cells.mjs` 定义功能单元，`engine/assemble.mjs` 负责整图拼装。
- 项目规格门禁：`project_spec.json` 定义用户需求层的模块、网络、接口和质量策略。
- Spec schema 门禁：`spec:schema` 验证 `project_spec.json` 是合法的第一层用户意图合同。
- 项目合同门禁：`project_contract.json` 定义模块、关键网络、接口、视觉证据区域和禁止自由绘图策略。
- 项目网表门禁：`project_netlist.json` 定义关键网络必连引脚，并证明生成模型实际连接这些端点。
- Circuit pack 门禁：`contract:pack` 验证所选 `pack.mjs` 已注册且暴露必要生成 hook。
- 库合同门禁：`contract:library` 验证每个 required part 都有批准的 Symbol、Device、Footprint、name/value 和 BOM/PCB 状态。
- Cell manifest 门禁：`circuit_packs/*/cell_manifest.json` 在装配前声明电路包 cell 的 ref role、netArg、端口和布局意图。
- 规则覆盖检查：`contract:rules` 会确认模块注册、必备零件、接口合同和核心规则覆盖了项目合同。
- 装配覆盖检查：`contract:assembly` 会确认每个合同模块都映射到了确定性 cell、anchor、refs 和 nets。
- 布局策略检查：`contract:layout` 会确认布局搜索来自 `project_assembly.json`，并验证最终模块间距、无榫卯穿插、无无关导线侵入。
- 合同兑现检查：生成 `full_model.json` 后，`contract:model` 会确认模型实际包含合同要求的模块、零件、网络和接口表达。
- 视觉证据检查：生成离线预览后，`contract:visual` 会确认合同要求的截图区域都存在且通过图像检查。
- 快速离线检查：`npm run fast` 在本机 CPU 上完成核心模板校验，适合日常坐标和规则迭代。
- 完整布局检查：`npm run pipeline` 运行布局搜索、结构审计、视觉节奏、文本覆盖、系统意图等检查。
- 真实 EDA 闭环：通过 WebSocket 桥写回 EasyEDA，再用 `snapshot2.js` 拉取实图快照做 live 校验。
- 网络标签约束：单页图纸优先使用 wire `Name` 属性作为真实网络名，不用普通文本伪装网络标签。
- 文档模板兼容：图纸标题栏交给 EasyEDA 原生模板变量；harness 不再额外绘制重复标题块。

## 设计原则

- 电气正确优先：关键网络必须连通，引脚端点必须精确落在导线端点上。
- 可读性同等重要：正交走线、模块分区、同侧对齐、网名不压器件、导线不穿符号。
- 写回前检查：模板检查、live 检查、DRC 都通过后再写回 EasyEDA。
- 小改快速闭环：日常调坐标先跑 `npm run fast`，批量稳定后再跑完整 pipeline 和 EDA live 验收。

## 环境要求

- Windows、Linux 或 macOS
- Node.js 18 或更新版本
- EasyEDA / 嘉立创 EDA 客户端
- 官方 EasyEDA API Skill：<https://github.com/easyeda/easyeda-api-skill>
- EasyEDA API bridge，默认监听 `http://127.0.0.1:49620/execute`

先安装并启动官方 skill。该仓库提供 EasyEDA Pro API 文档、`SKILL.md`、WebSocket bridge 和 EasyEDA 端 `run-api-gateway.eext` 扩展；官方 README 的 Quick Start 包含 `npm install`、`npm run build:docs`、`npm run server`，然后在 EasyEDA 中安装该扩展。bridge 启动后会在 `49620-49629` 端口等待 EasyEDA 客户端连接。

然后把本仓库交给 Codex、Claude Code 或类似 Agent。用户不需要逐条执行 harness 命令；Agent 应根据 `AGENTS.md` 完成依赖安装、连接检查、校验、截图证据和写回。

## 快速开始

给 Agent 的一句话：

```text
请按 AGENTS.md 接手这个仓库；如果是新项目，先建立项目合同、模块模板和规则覆盖，不要直接在 EasyEDA 里自由画。确认 easyeda-api-skill/Bridge，运行本地门禁；写回前必须拉取 EasyEDA live snapshot/截图/DRC 复核，只有全部 PASS 后才写回 EasyEDA。
```

Agent 会自动运行本地检查、生成预览图，并写出 `acceptance_report.json`、`next_actions.json` 和 `repair_actions.json`。如果检查未通过，`next_actions.json` 是接手摘要，`repair_actions.json` 会把每条 finding 映射到编辑目标、检查文件和下一条复跑命令。`node bin/easyeda-gsd.mjs repair` 会通过 `workflows/repair_loop.mjs` 生成只读的分组修复计划，并写出 `repair_loop_report.json`。
`next_actions.json` 是经过校验的 `schemaVersion=1` action contract；`npm run action:schema` 会检查 action id、标准化检查状态、target、evidence，以及 pass/actions 一致性。
`final:evidence` 会写出 `final_evidence_report.json`，证明所需证据产物存在、足够新、已通过，并且没有开放修复项。

推荐给 Agent 的入口：

```bash
node bin/easyeda-gsd.mjs accept
node bin/easyeda-gsd.mjs repair
node bin/easyeda-gsd.mjs live-check
node bin/easyeda-gsd.mjs apply --gated
```

新项目的第一步不是画图，而是让 Agent 修改 `project_spec.json`，再把它落实到 `project_contract.json`，用 `project_netlist.json` 定义必连端点，选择或声明 `circuit_packs/*/cell_manifest.json`，随后用 `project_assembly.json` 定义可执行装配映射和布局策略；通过这些门禁后再实现项目自己的 deterministic cells 和规则覆盖。
对于新项目目录，`node bin/easyeda-gsd.mjs init --pack <pack> --out <project-dir>` 会写出这些 scaffold 文件、`approved_library_manifest.json` 和 `gsd_scaffold_report.json`；scaffold 故意是不完整的，必须补齐到 `plan` 通过后才能进入生成。

## 写回 EasyEDA

Agent 会通过 `apply:gated` 写回 EasyEDA。这个入口会先运行检查；未 PASS 时不会写回。低层写回脚本只用于 Agent 调试，不作为用户入口。

## 预览、实图快照与截图证据

离线预览图由 harness renderer 生成，用于快速检查结构、模块区域和明显重叠。它不是 EasyEDA 真实画布截图，不能单独作为最终复核证据。

它会运行本地检查、live snapshot、真实画布图、EasyEDA DRC、模块级 live shots，并在需要时自动运行 live diagnose，最后写出 `acceptance_report.json`。
如果仍有检查未通过，先看 `next_actions.json`；它是给下一个 agent 的机器可读接手清单。随后看 `repair_actions.json`，它给出逐条 finding 的修复目标和复跑命令；也可以运行 `node bin/easyeda-gsd.mjs repair` 生成 `repair_loop_report.json`。

在 live 模式下，`contract:live:model` 会把真实 EasyEDA 画布拉取到的 `live.json` 与 `project_contract.json` 对照检查；最终验收不能只相信 `full_model.json`。

`live:shots` 会先尝试 EasyEDA zoom 区域截图。如果 EasyEDA API 对不同 zoom 请求返回同一张全页渲染图，工具会改用这张真实 EasyEDA 渲染图做坐标裁剪；只有模块图数量足够、裁剪区域在图内、hash 互不重复且图像检查通过时才算 PASS。

当 `live:shots` 指向固定渲染图时，Agent 会运行 live diagnose。诊断报告会记录 EasyEDA canvas 列表、当前文档/tab 信息，以及不同 zoom 请求后的截图 hash。

推荐每次写回前至少检查全局图和各功能模块局部图：USB、LDO、RESET、BOOT、MCU 左右侧、PMOS、RELAY1、RELAY2、标题栏区域。

## 检查清单

- 项目合同检查：`project_contract_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- 项目规格覆盖检查：`project_spec_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- Spec schema 检查：`spec_schema_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- 项目规则覆盖检查：`project_rule_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- 项目网表检查：`project_netlist_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- Circuit pack 检查：`project_pack_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- Cell manifest 检查：`cell_manifest_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- 项目装配覆盖检查：`project_assembly_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- 项目布局策略检查：`project_layout_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- 合同兑现检查：`project_model_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- 本地快速检查：`HARD=0 SOFT=0 INFO=0`
- 完整布局检查：`HARD=0 SOFT=0 INFO=0`
- 离线预览：至少生成 10 张全局/局部离线预览图，视觉审计 PASS
- 合同视觉证据检查：`project_visual_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- EasyEDA live：拉取 `live.json`，并复核从真实 EasyEDA 画布抓取的 `live_canvas.png`
- EasyEDA live 合同检查：`project_live_model_report.json` 中 `HARD=0 SOFT=0 INFO=0`
- EasyEDA DRC：`0 error / 0 warning / 0 info`
- EasyEDA live shots：至少 10 张模块级真实视觉证据互不重复
- `next_actions.json` 无开放接手摘要项
- `action_schema_report.json` 证明 `next_actions.json` 符合稳定 action schema
- `gsd_plan_report.json` 证明当前 spec 已由 contract、netlist、assembly 和 circuit pack 兑现
- `gsd_generate_report.json` 证明确定性生成经过 plan 门禁
- `project_library_report.json` 证明每个 required part 都有批准的库绑定
- `repair_actions.json` 无逐条 finding 修复项
- `repair_loop_report.json` 无分组修复项
- `final_evidence_report.json` 证明所需 local/live 证据存在、足够新并通过
- 无普通文本伪装网络标签
- 单页图纸不使用无必要的 NET PORT
- wire `Name` 锚点可读：左侧标签使用左下角，右侧标签使用右下角
- 模块之间有清晰矩形空间和合理间距，不发生榫卯式穿插
- 文本、器件属性、网名、GND/NC 符号无覆盖

## 关键经验

- EasyEDA wire `Name` 是真实网络名显示；`PrimitiveText` 只是文本，不能当网络标签。
- 实测 wire `Name` 原点：左侧标签使用 `alignMode=6`，右侧标签使用 `alignMode=8`。
- 修改 wire `Name` 属性时使用 `eda.sch_PrimitiveAttribute.modify()`；部分 `toAsync().setState_*().done()` 路径会产生坐标翻转问题。
- EasyEDA 创建导线更可靠的方式是按单段写入，折线需要拆成两点一段。
- 慢流程只应该用于写回前复核；坐标和规则迭代先走本地快速检查。

## 目录结构

- `engine/`：模板组装、布局搜索、写回、渲染、DRC/live 辅助。
- `bin/easyeda-gsd.mjs`：面向 Agent runner 和 CI 的中立工作流包装入口。
- `docs/agent-runner-guide.md`：给 Codex、Claude Code 和其它 Agent 的简明 runner 合同。
- `reports/README.md`：生成报告契约说明，包括 `next_actions.json` action schema。
- `harness/`：统一规则门禁、模型归一化、模块注册。
- `project_spec.json` / `project_contract.json` / `project_netlist.json` / `project_assembly.json`：用户意图、设计合同、结构化电气端点、可执行装配映射和布局策略。
- `contracts/spec_schema.mjs`：第一层用户意图输入的可复用 schema 校验。
- `contracts/module_contract.mjs` / `contracts/net_contract.mjs` / `contracts/layout_contract.mjs`：功能模块、电气端点意图和项目驱动布局策略的可复用校验器。
- `workflows/gsd_plan.mjs`：spec-to-contract 兑现计划器，写出 `gsd_plan_report.json`。
- `workflows/gsd_generate.mjs`：plan-gated 的确定性生成包装器，写出 `gsd_generate_report.json`。
- `workflows/gsd_scaffold.mjs`：新项目 scaffold 写入器，生成 spec、contract、netlist、assembly 和 `gsd_scaffold_report.json`。
- `contracts/library_contract.mjs`：required parts 的批准库绑定校验器。
- `workflows/repair_loop.mjs`：只读修复循环计划器，把 `next_actions.json` 和 `repair_actions.json` 分组成修复类型、文件、证据和复跑命令，并写出 `repair_loop_report.json`。
- `engine/final_evidence_gate.mjs`：fail-closed 的 local/live 证据门禁，检查新鲜度、DRC 归零、live model 证明和空修复项。
- `circuit_packs/*/cell_manifest.json`：电路包确定性 cell 能力合同。
- `circuit_packs/*/pack.mjs`：电路包生成 hook 和器件库归一化。
- `snap2.json`：器件快照输入。
- `comp_state.json`：器件状态输入，用于写回时保留器件绑定信息。
- `engine/bridge_client.mjs` / `engine/bridge_exec.mjs`：跨平台 EasyEDA bridge 执行入口。
- `run.ps1` / `run-save.ps1` / `run-image.ps1`：Windows 便捷包装脚本。
- `fix_wire_name_anchors.js`：修复 live 图中 wire `Name` 锚点的实用脚本。
- `remove_duplicate_title_block.js`：删除 harness 旧版自绘标题块的迁移脚本。

## 许可证

请在正式发布前按项目需求补充 LICENSE。

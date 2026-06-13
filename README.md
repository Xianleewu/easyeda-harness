# EasyEDA Harness

[English](README.en.md)

EasyEDA Harness 是一套面向 Codex、Claude Code 等编程 Agent 的原理图生成与校验工作流。它不是 EasyEDA API skill；官方 `easyeda-api-skill` 负责 API 文档、WebSocket Bridge 和 EasyEDA 扩展，本仓库负责结构化输入、确定性生成、本地门禁、离线预览、真实 EasyEDA 证据和受控写回。

最简单的使用方式是把这个仓库交给 Agent，并要求它遵守 `AGENTS.md` 或 `CLAUDE.md`。Agent 应安装依赖、确认官方 EasyEDA API Skill/Bridge、运行门禁、生成证据，并且只在所有检查通过后写回 EasyEDA。

中立入口是：

```bash
node bin/easyeda-gsd.mjs help
```

## 先安装官方 Skill

在需要 live 检查或写回 EasyEDA 前，先安装并启动官方 EasyEDA API Skill：

<https://github.com/easyeda/easyeda-api-skill>

它提供 EasyEDA Pro API 文档、`SKILL.md`、WebSocket Bridge 和 EasyEDA 侧扩展。Bridge 通常监听 `http://127.0.0.1:49620/execute`，或 `49620-49629` 范围内的端口。

## 工作流边界

这个仓库不是让 Agent 在 EasyEDA 里自由画图的提示词集合。新项目必须先建立可检查的机器合同：

- `project_spec.json`：用户意图和功能模块
- `project_contract.json`：模块、关键网络、接口、视觉证据区域、`drawingRules` 和禁止自由绘图策略
- `project_netlist.json`：关键网络必须连接的电气端点
- `approved_library_manifest.json`：每个 required part 的 Symbol、Device、Footprint 绑定
- `project_assembly.json`：模块到 deterministic cell、refs、anchors、nets 和 layout policy 的映射
- `circuit_packs/<pack>/pack.mjs` 和 `cell_manifest.json`：电路族行为和 cell 能力声明

当前模型 PASS 只证明当前模型通过，不证明其它项目、其它原理图或手工 EasyEDA 编辑符合规则。

## 给 Agent 的快速开始

可以直接给 Agent 这句话：

```text
请按 AGENTS.md 接手这个仓库。不要在 EasyEDA 中自由画图；先维护 project_spec.json、project_contract.json、project_netlist.json、approved_library_manifest.json、project_assembly.json 和 circuit pack。运行本地门禁；最终写回前必须通过 live-check、真实 EasyEDA 截图和 DRC 0/0/0。只允许通过 node bin/easyeda-gsd.mjs apply --gated 写回。
```

Agent 常用入口：

```bash
node bin/easyeda-gsd.mjs plan project_spec.json
node bin/easyeda-gsd.mjs generate project_spec.json
node bin/easyeda-gsd.mjs accept project_spec.json
node bin/easyeda-gsd.mjs repair
node bin/easyeda-gsd.mjs live-check project_spec.json
node bin/easyeda-gsd.mjs apply --gated
```

更完整的 Agent 约束见 `docs/agent-runner-guide.md`。对应 npm 门禁包括 `contract:pack`、`action:schema` 和 `apply:gated`；公开入口推荐使用 `node bin/easyeda-gsd.mjs ...`，底层 npm scripts 主要用于 CI、调试和细分 gate。

这些命令会写共享报告文件，必须串行执行。仓库内置 workspace lock，会阻止多个有状态工作流同时运行，避免报告互相覆盖产生假 PASS 或假 FAIL。

## 新项目流程

1. 用 `node bin/easyeda-gsd.mjs init --pack <pack> --out <project-dir>` 创建 scaffold。
2. 补齐 `project_spec.json`、`project_contract.json`、`project_netlist.json`、`approved_library_manifest.json` 和 `project_assembly.json`。
3. 如果是新电路族，补齐 `circuit_packs/<pack>/pack.mjs` 和 `cell_manifest.json`。
4. 确保每个 contract module 声明 `drawingRules`，每个 cell manifest entry 声明匹配的 `qualityRules`，覆盖正交走线、真实网标、文本 clearance、模块隔离、禁止 fake net text 和单页图纸无意义 net port。
5. 在 `project_assembly.json` 中声明 `layoutPolicy.flow`、有序 `layoutPolicy.columns`，并优先使用通用 `layoutPolicy.anchorVariants`。
6. 运行 `node bin/easyeda-gsd.mjs plan <project-dir>/project_spec.json`，直到 `gsd_plan_report.json` 通过。
7. 运行 `node bin/easyeda-gsd.mjs generate <project-dir>/project_spec.json`，直到 `gsd_generate_report.json` 通过。
8. 运行 `node bin/easyeda-gsd.mjs accept <project-dir>/project_spec.json`，直到本地门禁 `HARD=0 SOFT=0 INFO=0`。
9. 最终交付前运行 `node bin/easyeda-gsd.mjs live-check <project-dir>/project_spec.json`。
10. 只通过 `node bin/easyeda-gsd.mjs apply --gated` 写回。

## 主要门禁

- `workflow:smoke`：证明坏 spec、不完整 scaffold、缺失库绑定、失败 generate 都会被拦住。
- `spec:schema` / `spec`：证明 spec 格式正确，并被 contract 覆盖。
- `contract:library`：证明 required parts 都有批准的库绑定。
- `contract:cells`：证明选中的 circuit pack 声明了 deterministic cell 能力。
- `contract:assembly`：证明每个模块都映射到 cell、anchor、refs 和 nets。
- `contract:layout`：证明 layout policy、模块间距、无穿插和无无关导线侵入。
- `contract:model` / `contract:netlist`：证明生成模型满足合同和电气端点。
- `preview` / `contract:visual`：证明离线预览和视觉区域覆盖。
- `live-check`：拉取真实 EasyEDA `live.json`、`live_canvas.png`、live shots 和 DRC。
- `final:evidence`：证明所需证据新鲜、通过、且没有开放修复项。

## 证据文件

交付前至少检查：

- `acceptance_report.json`
- `gsd_plan_report.json`
- `gsd_generate_report.json`
- `workflow_smoke_report.json`
- `report.json`
- `visual_review_report.json`
- `next_actions.json`
- `repair_actions.json`
- `final_evidence_report.json`
- `live.json`
- `live_canvas.png`
- `live_shots_report.json`
- `project_live_model_report.json`
- `drc_report.json`

最终 DRC 必须是 `0 error / 0 warning / 0 info`。

## 经验规则

- EasyEDA wire `Name` 才是真实可见网标；`PrimitiveText` 只是文本，不能伪装网络标签。
- 单页图纸不应滥用 NET PORT。
- 左侧 wire `Name` 使用 `alignMode=6`，右侧使用 `alignMode=8`。
- 折线写回时按两点一段创建更可靠。
- 离线预览不是最终 EasyEDA 证据；最终必须以 live snapshot、真实 canvas、live shots 和 DRC 为准。

## License

正式发布前请补充 `LICENSE`。

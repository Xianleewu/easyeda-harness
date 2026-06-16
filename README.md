# EasyEDA Harness

[English](README.en.md)

EasyEDA Harness 是给 Codex、Claude Code 等编码 Agent 使用的 EasyEDA 原理图设计协作与验收工作流。它不是 `easyeda-api-skill`，也不是完整的自动原理图布局器，更不是让 Agent 自由画图的 prompt 包：官方 `easyeda-api-skill` 负责 EasyEDA API 文档、Bridge 和扩展；本仓库负责把用户需求变成结构化合同、确定性模板、布局门禁、几何/标签门禁、预览证据、live 证据和受控写回。

推荐用法很简单：把仓库交给 Agent，让它按 `AGENTS.md` 或 `CLAUDE.md` 执行。Agent 必须先确认官方 skill 和 Bridge 可用，再建立项目合同与模块模板，运行本地和 live 门禁，只有所有检查通过后才允许 `apply:gated` 写回 EasyEDA。

## 先安装官方 Skill

使用本仓库前，先安装并启动官方 EasyEDA API Skill：

- 官方仓库：<https://github.com/easyeda/easyeda-api-skill>
- Bridge 默认地址：`http://127.0.0.1:49620/execute`
- EasyEDA 侧需要安装并启用官方扩展，Agent 应读取 skill 的 `SKILL.md` 后再调用 API。

本仓库不复制官方 API 文档。Agent 需要 EasyEDA 操作细节时，应以 `easyeda-api-skill` 为准。

## 给 Agent 的最短提示

```text
Follow AGENTS.md for this repository. Install/verify easyeda-api-skill first. For a new project, create project_spec.json, project_contract.json, project_netlist.json, project_assembly.json, circuit_packs/<pack>/cell_manifest.json, and rule coverage before any drawing. Do not free-draw in EasyEDA. Use deterministic cells, run workflow:smoke and accept, collect live EasyEDA evidence, and write back only through apply:gated after every gate passes.
```

用户通常不需要逐条执行命令；命令是给 Agent 和 CI 使用的稳定入口。中立入口是 `node bin/easyeda-gsd.mjs`，详细 Runner 约定见 `docs/agent-runner-guide.md`。

工作流应像 UI 设计一样先形成短周期草案，再进入完整生成和验收。`node bin/easyeda-gsd.mjs design-brief` 会写出 `design_brief_report.json`，包含功能 block diagram、模块假设、pin/net plan、布局/接口计划、label column 计划、ERC/版式 checklist 和下一步任务。Agent 应先用这个 brief 发现模块矩形缺失、label column 缺失、pin map 缺失、接口方向不清、浮空 label 等问题，再继续写 deterministic cell。

## 工作流边界

新项目不能直接让 Agent 在 EasyEDA 里边看边画。必须先把设计意图落到机器可检查的文件：

- `project_spec.json`：用户级需求、模块、接口、关键网络和质量目标。
- `spec:schema`：检查 `project_spec.json` 的结构。
- `project_contract.json`：模块矩形、关键器件、接口、视觉证据区域和禁止自由绘制约束。
- `project_netlist.json`：关键网络必须连接到哪些器件引脚。
- `project_assembly.json`：模块到确定性 cell、锚点、网络和 `layoutPolicy.flow` / `layoutPolicy.columns` / `anchorVariants` 的映射。
- `layoutPolicy.moduleRegions`：每个模块自己的最小可读矩形空间，生成前就检查覆盖、列归属、尺寸、间距和重叠。
- `layoutPolicy.labelColumns`：可见 net label 的列、module、routeEnd、方向、预算、端点和原点策略。
- `circuit_packs/<pack>/cell_manifest.json`：cell 能力、端口、refs、布局意图和 `qualityRules`。

当前模板 PASS 只证明当前模板。换项目时，Agent 必须先补合同、netlist、cell manifest、assembly、规则覆盖和库绑定，不能把示例坐标当成通用设计器。

## 关键门禁

- `workflow:smoke`：证明坏 spec、缺库绑定、失败 generate、未完成 scaffold 都会被拦住，并写出 `workflow_smoke_report.json`。
- 新 pack 的 `init --pack <pack> --out <project-dir>` 会生成按模块拆分的 `cell_manifest.json` cell 模板和 `portLayout`，并让 `project_assembly.json` 引用这些 cell；agent 必须实现这些 deterministic builders，不能绕回自由绘图。
- `easyeda-gsd plan`：检查 spec 是否被合同、netlist、assembly 和 circuit pack 实现，并写出 `gsd_plan_report.json`。
- `easyeda-gsd design-brief`：生成快速审阅报告，说明 block diagram、pin/net plan、布局/接口计划、label column、ERC/版式 checklist 和下一步。
- `easyeda-gsd generate`：只有 plan 通过才生成模型，并写出 `gsd_generate_report.json`。
- `contract:pack`：检查选中的 circuit pack 和生成 hook。
- `contract:library`：检查器件 Symbol、Device、Footprint、名称、值和 BOM/PCB 状态。
- `contract:geometry` / `contract:geometry:live`：检查正交导线、异网交叉、导线穿越可见对象、文字/属性/符号/器件 bbox 重叠。
- `contract:labels` / `contract:labels:live`：检查真实 wire `Name`，禁止 fake `PrimitiveText` net label，检查左侧 `alignMode=6`、右侧 `alignMode=8`、同类标签成列、端点贴合、禁止散点 label。
- grouped-net-label 接口必须在生成前声明 source/target 两侧的 `layoutPolicy.labelColumns`，并用 `module` 与 `routeEnd` 解释标签属于哪个模块接口。
- `action:schema`：检查 `next_actions.json` 的稳定修复动作结构。
- `deliver`：最终交付门禁，写出 `delivery_report.json`，要求 live 证据而不是 local-only 结果。

所有门禁都应达到 `HARD=0 SOFT=0 INFO=0`。EasyEDA DRC 必须是 `0 error / 0 warning / 0 info`。

## 图纸规则

原理图可读性不是提示词要求，而是门禁要求。核心规则写在 `docs/schematic-design-rules.md`：

- 导线必须正交，端点必须落在引脚或声明的 wire endpoint 上。
- 不允许异网交叉、未命名交叉、导线穿符号或穿器件 body。
- 模块应在自己的矩形区域内完成，模块之间保持合理间距，避免互相穿插。
- 文字、器件属性、GND/NC 符号、net name 和器件 bbox 不得重叠。
- 单页原理图优先使用真实 wire `Name`，不要用多余 NET PORT，也不要用普通文本冒充 net label。
- 左侧 fanout label 使用左下角原点，右侧 fanout label 使用右下角原点；同侧同类 label 必须成列并贴在对应导线端点上。

这些规则必须由 `contract:geometry`、`contract:labels`、live snapshot 和截图证据共同验证。离线预览有用，但不能替代 EasyEDA 真实画布。

## 修复闭环

失败时，Agent 不应猜测或手改写回脚本，而应先看机器输出：

- `next_actions.json`：面向下一位 Agent 的开放问题和下一步。
- `repair_actions.json`：每条 finding 对应的编辑目标、证据文件和重跑命令。
- `repair_loop_report.json`：按问题类型聚合的只读修复计划。

修复应优先修改项目合同、确定性 cell、布局策略、label budget 或规则 writer。不要绕过门禁，不要在 EasyEDA 中自由修一两根线后声称完成。

## 最终证据

最终交付必须来自真实 EasyEDA live 检查：

- `acceptance_report.json`：完整验收报告。
- `design_brief_report.json`：证明生成前已经明确 block diagram、pin/net plan、布局/接口计划、label column、ERC/版式 checklist 和下一步。
- `final_evidence_report.json`：本地和 live 证据的新鲜度、完整性和通过状态。
- `delivery_report.json`：最终 handoff 报告。
- `live.json`、`live_canvas.png` 和模块级 live 截图：证明真实 EasyEDA 画布与合同一致。
- EasyEDA DRC：`0 error / 0 warning / 0 info`。

## 仓库结构

- `AGENTS.md` / `CLAUDE.md`：Codex、Claude Code 等 Agent 的操作约束。
- `bin/easyeda-gsd.mjs`：统一工作流入口。
- `docs/agent-runner-guide.md`：给 Agent Runner 和 CI 的简明协议。
- `docs/schematic-design-rules.md`：原理图版式、几何和标签规则。
- `contracts/`：spec、模块、netlist、布局、库绑定等合同检查。
- `circuit_packs/`：可复用 circuit pack、cell builders 和 `cell_manifest.json`。
- `engine/`：生成、布局搜索、门禁、写回、live snapshot、DRC 和证据收集。
- `workflows/`：GSD plan/generate/scaffold/repair 流程。
- `workflows/design_brief.mjs`：短周期设计审阅报告生成器。
- `reports/README.md`：生成报告和 action contract 说明。

Agent rule index: wire crossings, object overlap, left-bottom/right-bottom origins.

## License

正式公开发布前请补充 LICENSE 文件。

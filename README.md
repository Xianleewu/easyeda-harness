# EasyEDA 原理图美化工具

[English](README.en.md)

一个**通用、公共的工具**:把**任意** EasyEDA 原理图变成干净、商用级的 2D 布局——像前端设计工作流,
但面向电路图。**零特定电路内容**——它通过角色与模式适配任意板,绝不硬编码任何特定电路的器件、网名或模块。

## 原理

1. 从 EasyEDA 捕获任意打开的板 → `live.json`。
2. 把器件分类到角色(`role_infer`)→ 用角色化原型单元(`circuit_packs/archetypes/`)渲染各模块
   → 2D 装箱排列干净模块(`module_repack`,破解"宽列式 vs 纵横比"死锁)→ 跑商用几何/标签门
   (`geom_qc` / `label_qc`)。
3. 把干净布局投回 live EasyEDA。

## 快速开始

```bash
npm install
npm run live:save                              # 捕获打开的板 -> live.json(含引脚电气类型)
node bin/plexus.mjs audit   live.json          # 商业化布局诊断:6 类(连接/走线/间距/电源地/标注/结构)按严重度量化
node bin/plexus.mjs qc      live.json          # 网级体检:短路/杂散电源标/畸形线/ERC引脚类型/悬空标
node bin/plexus.mjs repair  live.json          # 自动修复(删杂散电源短路标/拉直畸形线)并报 DRC 前后
node bin/plexus.mjs layout  live.json out.png  # 任意板 -> 商用 2D 布局 + 渲染 + 门
node bin/plexus.mjs deliver live.json          # 投递到 live EasyEDA
npm test                                       # 通用测试套件
```

已有原理图的受保护实时工作流使用 `wf.mjs`。`lint` 只读并生成绑定当前文档、源码、规则和证据的
上下文；`compile` 在本地拒绝红候选；不超过 25 个装配器件的小板可用一键轨道：

```bash
EASYEDA_TOKEN_EVIDENCE=/absolute/evidence.json node wf.mjs lint
node compile.mjs /private/transform.mjs
node wf.mjs quick /private/transform.mjs       # lint → compile → 一次提交 → 一次最终截图审计
```

> 体检/修复闭环:`qc` 检测 → `repair` 修复 schematic 层可修缺陷(几何/短路标)+ 报 DRC 前后。
> ERC 引脚电气类型错标(无源件标 IN、GPIO 标 Undefined)由 `qc` 检出但需在 EasyEDA 符号库编辑器修正
> —— 引脚电气类型由符号定义,扩展 API 只读不可写。

需先安装并启动官方 [EasyEDA API skill](https://github.com/easyeda/easyeda-api-skill)(WebSocket Bridge +
EasyEDA 扩展;Bridge 默认 `http://127.0.0.1:49620`,端口 `49620-49629`)。打开**任意**原理图即可。

## 设计语言

`docs/schematic-design-rules.md`(DR1–DR18 可测门)与 `docs/schematic_design_rulebook.md`
(项目无关的设计语言:对象/连通、布局拓扑、布线策略、几何门、角色化电路原型、验证流)。
商用交付目标:EasyEDA DRC `0 error / 0 warning / 0 info`。

完整架构见 `AGENTS.md`。**绝不在本工程加入任何特定电路内容——这是公共工具。**

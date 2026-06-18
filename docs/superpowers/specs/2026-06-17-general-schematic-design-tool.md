# 通用原理图设计工具 — 设计稿

- 日期: 2026-06-17
- 状态: 待用户评审
- 取代: 对单图的就地 band-aid(`relayout_compact` 的紧凑挪动思路)——保留其可逆写/分批/审计基石,但**布局不再靠微调坏摆放,改为从设计语言合成**。
- 关联: `docs/schematic_design_rulebook.md`(通用设计语言)、`docs/schematic-design-rules.md`(DR1–DR18 可量契约)、`engine/layout_planner.mjs`、`engine/geom_qc.mjs`、`engine/label_qc.mjs`、`engine/design_conformance.mjs`、`engine/finding_classifier.mjs`、`engine/bridge_client.mjs`。

## 1. 目标

做一个**高效、通用**的工具:对**任意**原理图,使其遵守我们的设计语言——优美、合理。
不是针对单张图不停打补丁(那种工具流没用),而是一套对任何图都成立的方法。

## 2. 方法论来源(前端设计 skill 怎么做的)

研究 `frontend-design` 与 GSD 插件的 UI 系列(`ui-phase`/`ui-review`/`ui-checker`)得到可迁移范式:

| 前端做法 | 本质 | 原理图迁移 |
|---|---|---|
| 写 `UI-SPEC.md` 设计契约(间距=4 的倍数、字号≤4、强调色穷举元素、禁 "Submit") | 设计语言→**显式可量机械可查**的 token | 原理图设计契约:信号流列序、模块区、cell 原型、间距/标签/布线 token |
| 全程引用契约**生成**,绝不在烂页面挪 div | 质量来自系统,不补丁 | **丢摆放、留逻辑、从契约合成布局** |
| 6 支柱审计,每维 1–4 分,grep+算术**取证** | 机械、证据化,非主观 | 6 支柱原理图审计(结构/紧凑/布线/标签/支撑贴合/惯例) |
| 每维 BLOCK/FLAG/PASS,任一 BLOCK 拦截,迭代≤2 | 快速失败门控 | 同构门控+迭代到 PASS |

**核心一句:不是在坏布局上挪元素变好,而是从设计系统重新渲染。**

## 3. 架构(五段流水线)

```
任意原理图(live/快照)
 │ ① 抽取  Extract     丢摆放,留逻辑：器件 + 角色 + 网表 + 电源/地/信号分类
 │ ② 契约  Contract    设计语言→具体 token：信号流·模块列·cell 原型·间距/标签/布线
 │ ③ 合成  Synthesize  从契约生成布局：模块进列→按原型摆 cell→正交布线→标签纪律
 │ ④ 审计  Audit       六支柱机械取证打分 → BLOCK/FLAG/PASS
 │ ⑤ 门控  Gate+Iterate 未 PASS 回 ③ 调参；PASS → 可逆分批写回
```

每段单一职责、接口清晰、可独立测试。

### 3.1 ① 抽取 Extract — `engine/schematic_extract.mjs`(新建)
- 输入: live 快照(`live.json`：components/pins/wires/netflags/texts)。
- 输出: **逻辑模型** `logical_model.json` = `{ parts:[{ref, kind, value, pins, attrs}], nets:[{name, pins:[ref.pin], class:'power|ground|signal'}] }`。
- 做法: 由引脚坐标↔导线端点↔网标重建网表(本会话已验证引脚为绝对坐标、47% 端点贴引脚);电源/地按 netflag 与命名网分类;**丢弃所有 x/y/摆放**。
- 纯函数核心(网表重建)可单测。

### 3.2 角色推断 — `engine/role_infer.mjs`(新建)
- 输入: 逻辑模型。输出: 每个器件的**角色**(connector/regulator/controller/switch/driver/support-passive/indicator…)+ 所属**功能模块**。
- 角色启发式: 引脚数/前缀(R/C/L/D/Q/U/J/SW)+ 连接的网类(电源/信号)+ 邻接(去耦贴电源脚、上拉贴信号)。
- 模块推断: **按命名网/局部连通性聚类**(替代项目特定模块注册表;本会话已证实模块主要靠命名网互连)。
- 纯函数,可单测;映射到 §3.5 的 cell 原型库。

### 3.3 ② 契约 Contract — `engine/design_contract.mjs`(新建,复用 `layoutPolicy` schema)
- 输入: 角色+模块。输出: **为这张图推断出的设计契约**(= harness `layoutPolicy` 的通用化):`flow`、有序 `columns`(输入左/控制中/负载右,由角色定)、`moduleRegions`、`labelColumns` 预算、间距/布线 token。
- token 源自 `schematic_design_rulebook.md` + DR1–DR18,**不再每项目手写**。

### 3.4 ③ 合成 Synthesize — 扩展 `engine/layout_planner.mjs`/`layout_worker.mjs`
- 输入: 逻辑模型 + 契约。输出: **候选布局**(每器件目标 x/y/rotation + 导线正交路由 + 标签摆放)。
- 模块按列摆 → 模块内按 cell 原型摆器件(支撑件贴所服务引脚)→ 正交自动布线(避本体/避交叉)→ 标签进预算列。
- 复用 harness 既有确定性 cell 与 planner;新增"从推断模块/角色驱动"而非手写 anchors。
- **不保留原摆放**(这是与 band-aid 的根本区别)。

### 3.5 cell 原型库 — `circuit_packs/archetypes/`(新建,通用)
- 角色化、项目无关: 输入/连接器单元、电源/稳压单元、控制器核心、高边开关、低边驱动、支撑无源列(见 rulebook §6)。
- 每原型声明: 锚点、四侧(源/负载/控制/回流)、内部相对摆放、引脚 escape 方向。

### 3.6 ④ 审计 Audit — 扩展 `engine/design_conformance.mjs` 为六支柱
对候选/实时图机械取证打分,每维 1–4 + BLOCK/FLAG/PASS:

| # | 支柱 | 机械判据 | 复用 |
|---|---|---|---|
| 1 | 结构/信号流 | 模块质心 X 序 vs 角色(输入左/控制中/负载右) | role_infer |
| 2 | 紧凑/分离 | 模块密度·间隙≥阈值·无拼图咬合·填充率 | structure_metrics 思路 |
| 3 | 布线 | 0 斜线/0 穿本体/0 异网交叉/段长/绕路比 | `geomQC` |
| 4 | 标签 | 列预算/alignMode/端点贴合/无散标假标 | `labelQC` |
| 5 | 支撑件贴合 | 支撑无源件到所服务引脚距离≤阈值 | role_infer+几何 |
| 6 | 惯例一致 | 电源地=netflag·NC=引脚态·重复单元同构·无尖头网口 | 对象策略检查 |

- 任一支柱 BLOCK → 整体 BLOCKED;全 PASS/FLAG → APPROVED。
- 通用: 无契约时退化到 rulebook 基线阈值(对应前端"无 UI-SPEC 用 6 支柱基线")。

### 3.7 ⑤ 写回 — 复用 `engine/bridge_client.mjs` + 可逆/分批
- 候选 APPROVED 后,经桥把目标 x/y/line 写回(`setState_X/Y`、`setState_Line`,本会话已验证)。
- **教训(必须遵守)**: 桥单请求 **30s 上限** → 写必须**分批(≤~30 图元/批)**;每批后续批;全程 **undo 日志(快照绝对坐标可还原)**;写后复跑审计+DRC,变差则回滚。

## 4. 数据流与产物
```
live.json → logical_model.json → roles_modules.json → design_contract.json
        → candidate_layout.json → conformance_report.json(六支柱)
        → (APPROVED) 分批写回 + relayout_undo.json → 复跑 live_audit/审计
```

## 5. 复用 vs 新建
- **复用**: `layout_planner`/cells/contracts/`layoutPolicy` schema(harness 自有生成管线本就这么干)、`geomQC`/`labelQC`/`design_conformance`、`finding_classifier`(电气 DRC 清理:标准化/悬空/网标仍走它)、`bridge_client`、undo/分批写。
- **新建**: `schematic_extract`、`role_infer`、`design_contract`、`archetypes/`、`layout_planner` 的通用驱动、六支柱 `design_conformance` 扩展。

## 6. 通用性原则
- 只依赖**逻辑内容**(网表+角色)——任何图都有;摆放被丢弃,故不受原图乱布局影响。
- 角色/模块**推断**而非手写注册表(现有 `design_score.mjs` 硬绑项目模块名,不通用,被取代)。
- 无契约 → 退化到 rulebook 基线阈值,仍可审计任意图。

## 7. 电气清理(与布局正交,保留)
DRC 三类(器件标准化 74 / 悬空 13 / 残留网标 3)是**电气**问题,不靠布局解决:沿用本会话已建的 `finding_classifier` + 混合交互(可自动判的自动改、模糊项问人)。布局合成专注"优美合理"。

## 8. 非目标 / 风险
- 正交**自动布线**是开放 R&D(本架构分步:先模块列+原型摆放,再逐步强化路由),不承诺一蹴而就。
- 写回有桥 30s 分批限制与导线重 id 现象(还原按绝对坐标、容忍少量 id 失配)。
- 角色推断有不确定性 → 模糊项可走交互确认(混合模型),不瞎猜。

## 9. 建议构建顺序(契约先行,对齐前端)
1. **六支柱审计**(扩 `design_conformance`)= 可量目标/门,先定义"完成"。
2. **抽取 + 角色/模块推断**(`schematic_extract`+`role_infer`)= 逻辑地基。
3. **契约 + cell 原型 + 合成**(`design_contract`+`archetypes`+`layout_planner` 通用驱动)。
4. **可逆分批写回 + 迭代环**,先在一个模块端到端打通,再横向扩到全图。

每步纯函数 TDD,几何/审计可在本地快照夹具验证,实时写一律可逆+分批+复跑。

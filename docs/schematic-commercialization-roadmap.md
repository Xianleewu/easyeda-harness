# 原理图商业化改进路线图(通用方法论)

> 适用于**任意** EasyEDA 原理图。本工具的价值=像前端设计工作流一样,把一张"能用但乱"的原理图
> **重排成商用级**(器件归位、走线正交、间距规整、电源地规范、标注齐全)。
> 检测靠 `engine/layout_audit.mjs`(6 大类可量化探针);修复靠生成路径 + 各类修复脚本。零特定电路内容。

## 0. 评估标准(商用级 = 全部门为 0)

| 类别 | 探针 | 商用底线 |
|---|---|---|
| 连接完整性 | `auditConnectivity` | 0 漏连、0 未标 NC 浮空脚、0 单节点信号网 |
| 走线规范 | `auditRouting` | 0 斜线、0 异网交叉、0 短路、0 线穿件/脚、0 畸形线 |
| 器件间距对齐 | `auditSpacing` | 0 重叠、净间距 ≥8px、原点吸栅格 |
| 电源地处理 | `auditPowerGround` | 0 杂散标、0 悬空标、去耦就近(<120px) |
| 标注完整 | `auditAnnotation` | 0 缺值、引脚电气类型正确 |
| 标签结构 | `auditStructure` | 0 标签硬伤、纵横比≤2.5、填充率合理 |

EasyEDA DRC 所有等级计数 = 0 是另一条独立底线(部分需符号库 GUI)。

## 1. 关键认知:为什么"器件没动"

把 DRC 计数清零 ≠ 商业化。**真正的重排是移动器件到干净布局**,这一步靠生成路径
(`cluster_generate` → 模块化布局)+ **投递**(`deliverGenerated` 移件+重画)。
但投递前提是**网表完整**——否则移件后无名本地连接全断。这是本路线图的 P0。

## 2. 优先级路线图

### P0 — 网表完整性(一切重排的前提)【BLOCKER】
- **问题**:`buildCleanLogical` 原只提【命名网】,丢【无名本地线】(脚到脚直连,如 LED 链 DO/DI、
  本地反馈/分压网)。诊断探针 `C1-lost-connection` 量化"有线连但不进网表"的脚。
- **影响**:任何重排/重画都会断掉这些连接 → 越改越糟。
- **修复**:`buildCleanLogical` 加 **union-find over 所有线**(含无名)恢复连通;无名连通分量=
  本地网(class `local`),生成路径**簇内直连不打标签**(避免历史 N$ 标签汤)。
  需三处集成:① 提取(union-find)② 聚类(本地网共享件归同簇)③ 布线(本地网直连)。
- **验收**:`auditConnectivity.lostConn === 0`,且重排后连通性 = 重排前。

### P1 — 重排并投递(修走线/间距/标签/结构)
- **问题**:器件位置原封不动 → 走线乱、间距粘连、标签叠压、图纸散乱。
- **修复**:生成路径 `cluster_generate`(角色聚类 + 脚密度展开 + node-rail + 去突 + 正交化)
  产模块化干净布局 → `deliverGenerated` 移件 + 重画(依赖 P0 保连通)。
- **验收**:`auditRouting/auditSpacing/auditStructure` 各门 → 0;EDA 截图目视商用观感。

### P2 — 标注与未用脚
- **问题**:无源件缺值/型号;未用 GPIO 浮空未标 NC。
- **修复**:`resolveDisplayValue`(从 attrs 解析真实型号,已实现);未用脚标 No-Connect
  (扩展 API 不支持 NC 标,需 GUI 或脚本);模块标题带真实型号。
- **验收**:`auditAnnotation.noVal === 0`;浮空脚或连接或标 NC。

### P2 — 电源/地规范化
- **问题**:悬空电源标、去耦电容远离 IC、密集电源标列未合轨。
- **修复**:`consolidateRails`(密集 flag 列合竖轨,已实现);去耦专用竖列贴 IC 电源侧
  (`layoutClusterTemplate` 已实现);清悬空标。
- **验收**:`auditPowerGround` → 0。

### P3 — 符号库级 ERC(GUI,在 API 之外)
- **问题**:引脚电气类型错(无源件标 Input、MCU GPIO 标 Undefined)→ ERC warn。
- **修复**:**EasyEDA 符号库编辑器 GUI** 改引脚电气类型——引脚类型在云端库符号中,
  扩展 API 五层(primitive/lib/文档源/文件层/驱动判定)穷尽证明只读不可写。
- **验收**:EDA DRC ERC 计数 = 0(需用户 GUI 操作)。

## 3. 执行顺序与依赖

```
P0 网表完整(union-find 本地网)  ← 一切的前提
   └─> P1 重排+投递(生成路径 deliver)  ← 修绝大多数布局门
          ├─> P2 标注(值解析 + NC)
          └─> P2 电源地(合轨 + 去耦就近)
   ⟂  P3 符号库 ERC(GUI,独立,可并行交用户做)
```

## 4. 探针/修复脚本清单(engine/)

| 模块 | 职责 | 状态 |
|---|---|---|
| `layout_audit.mjs` | 6 类综合诊断(本路线图评估标准) | ✅ 已建 |
| `geom_qc.mjs` / `label_qc.mjs` / `net_qc.mjs` | 走线/标签/网级底层门 | ✅ 已有 |
| `cluster_generate.mjs` | 角色聚类 + 模块布局 + 投递(P1) | ✅ 有,P0 本地网待集成 |
| `connectivity_recover.mjs` | union-find 恢复无名本地网(P0) | 🔲 待建(本轮) |
| `module_repack.mjs` | 2D 装箱重排(P1) | ✅ 已有 |

> 用法:`node bin/plexus.mjs audit <snap.json>`(诊断)→ 修 P0 → `deliver`(重排投递)→ 复诊。

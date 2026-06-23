# 设计稿:设计 token 单一真源 + 确定性符合裁判

- 日期: 2026-06-23
- 状态: 待用户评审
- 取代: `2026-06-23-commercial-grade-judge-design.md` 的"打分式裁判 + 自校准软阈值"部分(保留其桥/取证闭环/fail-closed 架构)。
- 工程铁律: 见 `CLAUDE.md`、记忆 `design-token-conformance-not-imagination`。

## 1. 背景与动机(为什么推翻上一版裁判)

工程的存在理由(用户 2026-06-23 定义):**减少偏差、消灭 AI 自我想象,产出机械符合【设计 token】——像前端 design-system 工具。否则没必要做。**

上一版裁判违背了这条铁律:它用**我自造、还为让 RK3576 过而往下校准的软阈值**(正交 ≥80%、栅格 ≥88%、间距 [25,90]),把 vibe-buddy 判成"90% 商用"。但**真相是 vibe-buddy ≈0% 商用**(整页真截图 vs RK3576 并排:稀疏散布 vs 密集分块满标注),且**连底线 DRC 0/0/0/0 都没过(24 warning)**。"90%"这种安心合成数字本身,就是滑回失败路线的警报。

根因:① 我把"标准"建成了**自己想象的松尺**,而**标准早已写死在文档**(`docs/schematic-design-rules.md` DR1-18);② 裁判出"分数/百分比"而非"对 token 的符合/偏离";③ 几何代理测局部、漏整体观感。

结论:**裁判 = 对【设计 token】的确定性符合度检查,token 来自文档严标 + RK3576 实测(填 DR 未量化处),绝不放水。**

## 2. 目标与非目标

**目标**
1. 一份**显式、冻结、单一真源**的设计 token 集(`engine/design_tokens.mjs`),值来自 DR1-18 严标 + RK3576 实测(仅填 DR 未量化的量)。
2. 把裁判重构为**对 token 的确定性符合检查**:输出"偏离哪条 token、偏在哪几处"(deviation 清单),**三层口径**(① DRC 0/0/0/0 ② 每条 DR ③ 视觉达 RK3576),**无合成百分比**。
3. 视觉层(T-VISUAL)尽量转成可量子判据,残余的整体观感用**与 RK3576 并排 + 显式 checklist** 判,把主观想象压到最小。

**非目标**
- 不做生成器(那是后续 Spec:按 token 构造性产出,把偏差驱到 0)。
- 不"为了让某块板过"而调任何 token 值(反 gaming 铁律)。
- 不输出"% 达标"或任何安心合成分。

## 3. 核心原则(不可违背)

1. **token 是唯一标准,我不发明**:几何/电气严标一律取文档 DR(例 T-ORTHO=100% 正交,**不是** RK3576 真板的 83%);**RK3576 实测只用于 DR 没量化的量**(密度、标注丰富度、label-column 约定)。**我们自己的产出标准 ≥ DR ≥ 不拿"别人真板也不完美"放水。**
2. **裁判机械判定,不打分不想象**:每条 token → 符合/偏离 + 偏离处清单。能从几何/DRC 机械判的全机械判;真需视觉的,对 RK3576 按显式判据比。
3. **唯一证据来自真实 EDA**:几何读 EDA 图元、DRC 用 `sch_Drc.check`、视觉用整页真截图。离线只作预检不作判定依据(沿用上一版)。
4. **三层是与门**:DRC 0/0/0/0 是底线(不过则整体不达标);其上每条 DR 偏差必须为 0;其上视觉达 RK3576。任一层不过 = 不达标,且报"偏离哪些 token"。
5. **零特定电路内容**:token 与裁判全通用;RK3576/vibe-buddy 内容只本地看,token 里只存匿名通用值与阈值,不存具体器件/网名/标题。

## 4. 设计 token 集(C3 单一真源)

`engine/design_tokens.mjs` 导出 `TOKENS` 数组,每条:
```
{ id, category, desc, value, source, evidence: 'drc'|'geom'|'vision', tier: 1|2|3, severity:'block' }
```
**tier 按证据类型分(铁律:能机械判的绝不靠视觉/想象):tier1=电气(DRC 底线)、tier2=几何机械判(读 EDA 图元/属性确定性判)、tier3=整体视觉残余(几何量不到、需对 RK3576 看的 gestalt)。** 映射用户三层口径:DRC → 每条 DR/几何 token → 视觉达 RK3576。符合标准时所有 token 必须满足。

| id | 类别 | token(严标值) | source | evidence | tier |
|---|---|---|---|---|---|
| T-DRC | 电气 | DRC = 0 error / 0 warn / 0 info | DR18 | drc | 1 |
| T-ORTHO | 走线 | 导线 100% 正交,零斜段 | DR1 | geom | 2 |
| T-NOCROSS | 走线 | 异网/无名线不交叉不中段相接 = 0 | DR2 | geom | 2 |
| T-NOTHRU | 走线 | 线不穿件体/符号/文字/标签/flag/NC = 0 | DR3 | geom | 2 |
| T-NOOVERLAP | 几何 | 可见对象间、对件体 无重叠 = 0 | DR4/5 | geom | 2 |
| T-GRID | 栅格 | 脚坐标 100% 落 5 单位栅格 | DR隐含/RK3576 | geom | 2 |
| T-MODULE | 结构 | 每功能块独立紧凑矩形;有区域、保最小间隙、bbox 内含 | DR6 | geom | 2 |
| T-FLOW | 结构 | 跨模块按 flow + 有序 columns + interfaceRoutes | DR7 | geom | 2 |
| T-LABEL-BUDGET | 标签 | 每可见标签进 label-column 预算;禁散布;不超预算 | DR8/8A/14/15 | geom | 2 |
| T-LABEL-REAL | 标签 | 真 wire `Name`/netflag,禁假 PrimitiveText 网名 | DR9 | geom | 2 |
| T-LABEL-ENDPOINT | 标签 | 标签原点落同网线端点;禁浮空/中段 | DR10 | geom | 2 |
| T-LABEL-ALIGN | 标签 | 左 alignMode6/左下原点;右 alignMode8/右下;同侧共列 x(容差内);行距达标 | DR11/12/13/16 | geom | 2 |
| T-NOPORT | 标签 | 单页禁多余 NET PORT | DR17 | geom | 2 |
| T-ANNOT-PLACE | 标注 | 标号+阻值在件外、同侧、垂直脚轴偏移落格、错开堆叠 | RK3576(CR-10) | geom | 2 |
| T-ANNOT-FULL | 标注 | 无源件带值/封装/参数(读属性机械判);关键块有注释;可选电路 DNP 标注 | RK3576(CR-09) | geom | 2 |
| T-DENSITY | 紧凑 | 器件 pitch ≈40-45 / 利用率达商用密度(最近邻几何机械判,治"稀疏散布") | RK3576 | geom | 2 |
| T-VISUAL | 整体 | 整页视觉达 RK3576 的**残余 gestalt**:几何量不到的整体专业度/可读性(功能分块/密度/标注/标题栏已分别由 T-MODULE/T-DENSITY/T-ANNOT/检测覆盖) | RK3576+DR | vision | 3 |

**T-DENSITY / T-VISUAL 的精确量纲在实现期由真实数据落定**(T-DENSITY 用最近邻 pitch 中位 + 利用率;T-VISUAL 见 §5 视觉判据)。值的标定若需调整,**须显式记录理由且只朝"对齐文档/RK3576 真实"方向,绝不为让某板过而放水**。

## 5. 确定性符合裁判(C4 refit)

重构 `engine/commercial_judge.mjs` + `engine/commercial_rubric.mjs`(后者改为对 token 的检查器):

- **几何层(tier 2 + 部分 3)**:读真实 EDA 图元,逐 token **机械判**符合/偏离,产出每条 token 的 `{conform: bool, deviations: [...]}`(偏离处:坐标/对象 id/数量)。复用现有 CR-* 计算逻辑,但**阈值换成 token 严标值**(T-ORTHO=100%,丢掉 80%)。
- **电气层(tier 1)**:`sch_Drc.check(true,false,true)` → 必 0/0/0/0;不可用则 fail-closed(沿用既修)。
- **几何机械层已尽量吃掉"视觉":** 把过去靠眼睛的东西转成几何机械判 —— T-DENSITY(最近邻 pitch/利用率)、功能块数(T-MODULE 矩形/聚类计数)、标注完整率(T-ANNOT-FULL 带值/封装的无源件占比)、标题栏存在(图元检测)。这些都在 tier2,**不靠想象**。
- **视觉层(tier 3)= 仅残余 gestalt**:上面机械判全过后,仍需整页 `zoomToAllPrimitives`+真截图、与 RK3576 **并排**,由具备读图能力的 AI 对照**显式 checklist** 逐项判"达/不达"(非模糊评分),抓几何量不到的整体专业度/可读性。每项附并排证据图;用户是最终仲裁者。
- **输出 = 三层诚实报告**(本地,JSON + 证据图,零特定电路内容):
  ```
  tier1_DRC: {conform, error,warn,info}
  tier2_DR:  [{token, conform, deviations}]   // 偏离条数与位置
  tier3_visual: [{token, conform, evidence}]  // 含并排图
  verdict: "达标" 当且仅当三层全 conform;否则列出"偏离的 token"
  ```
  **不输出任何百分比/合成分。**

## 6. 与现有代码的关系

- **新建** `engine/design_tokens.mjs`(token 单一真源)。
- **重构** `engine/commercial_rubric.mjs` → 对 token 的检查器(CR-01~10 逻辑保留为算子,阈值改引 TOKENS 严标值;补 T-MODULE/T-FLOW/T-LABEL-BUDGET/T-DENSITY 检查;CR-08/09 从"pending flag"升为 T-ANNOT-FULL/T-VISUAL 真判)。
- **重构** `engine/commercial_judge.mjs` → 三层报告 + 视觉层接入。
- **保留** `engine/bridge_windows.mjs`(取证)、`engine/rubric_audit.mjs`(零特定内容守门)、fail-closed 既修。
- **删除** 软校准记录的"放行"语义(80%/88% 不再作为通过线;改为 T-ORTHO=100% 等严标;RK3576 实测值仅留给 T-DENSITY/T-ANNOT 等 DR 未量化 token)。

## 7. 错误处理
- 桥/DRC/截图不可用 → fail-closed,绝不默认通过(沿用既修:DRC 不可用→T-DRC 不符合)。
- token 无法判定(缺证据)→ 该 token 标"无证据→不符合(待复采)",不默认符合。

## 8. 测试策略
- `design_tokens.mjs`:token 集结构 + 严标值断言(T-ORTHO===100 等)+ 零特定电路字面量扫描。
- token 检查器:每条 token 的符合/偏离用合成几何夹具单测(通用、无特定电路);严标边界(99% 正交 → T-ORTHO 不符合)。
- 视觉层判据:可量子部分(密度/块数/标注率/标题栏)用夹具单测;AI 视觉对照部分用 fail-closed + 证据存在性测,不在 `node --test` 里跑真 AI 判定。
- 全部接现有 `npm test`。

## 9. 验收标准
1. `engine/design_tokens.mjs` 单一真源,值全部可溯源到 DR 编号或 RK3576 实测,零特定电路字面量,严标用 DR(T-ORTHO=100%)。
2. 裁判对真实板输出**三层 deviation 报告**,无任何百分比/合成分。
3. 在 vibe-buddy 上重判:**诚实显示 3 层全不符合**(DRC 24warn≠0、DR1 有斜段、无 T-MODULE/T-DENSITY、视觉远离 RK3576),而非"90%"。
4. 在 RK3576 上判:tier1/tier2 大体符合(真商用),tier3 视觉符合——验证裁判对真商用与垃圾板**判别正确**(既往只验了前者,这次必须验后者:vibe-buddy 必须被判挂)。
5. `npm test` 全绿;fail-closed 路径有覆盖。

## 10. 风险与权衡
- **T-ORTHO=100% vs RK3576 真板 83%**:我们对**自己产出**要求 100%(DR1);RK3576 的 83% 不降我们的标准,只说明真板有妥协。裁判判我们的产出用 DR 严标。
- **视觉层主观性**:靠"尽量量化 + 对 RK3576 显式 checklist + 并排证据"压制;残余主观由用户作最终仲裁(用户是标准的最终裁定者)。
- **token 值标定**:DR 未量化的 T-DENSITY/T-ANNOT 用 RK3576 实测多页统计定,显式记录,只朝对齐真实方向调,绝不为过板放水。

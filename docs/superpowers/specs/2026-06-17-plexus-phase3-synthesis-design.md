# Plexus Phase 3 · 合成词汇层(design_contract)设计

- 日期:2026-06-17
- 范围:Phase 3「合成」的**第一块地基**——把审计模型编译成通用、确定性的布局契约 token。
- 不在本轮范围:archetype 原型库、自动摆放/正交布线求解器(realizer)、可逆桥写回。

## 1. 背景与动机

Plexus 审计半部已闭环:`extractLogical → inferRoles → auditPillars`,对任意已连接原理图给出六支柱机械判决(44 单测全绿)。

合成半部(Phase 3)是从设计语言**生成**布局,是多回合工程。现有生成轨道的 `project_assembly.json / layoutPolicy` 词汇虽丰富,但**手写、锚点相对(dx/dy)、与 AIHWDEBUGER 模块名硬耦合**,无法泛化(见 `docs/next-session-handoff.md` 第 4 项)。

本设计建立合成轨道的「原理图版 UI-SPEC」:一个从 `inferRoles` **自动派生**、对任意图通用、且可被同一套六支柱在日后 place+route 后复审的**纯数据契约**。

## 2. 决策(已与用户确认)

1. 本轮切片 = `design_contract` 合成词汇层(纯数据变换 + 单测,**无求解器**)。
2. schema = 新建**通用合成 schema**,从 `inferRoles` 自动派生,与 AIHWDEBUGER 生成轨道**解耦**。
3. 坐标抽象 = **抽象网格**(列序号 + 行序号 + 格数,无量纲);绝对坐标留给日后 realizer。
4. 验证 = 确定性单测 + 自洽不变量;本轮**不建 realizer**。

## 3. 架构与数据流

```
live.json → extractLogical → inferRoles → synthesizeContract(roles, logical) → contract tokens
                                                                                      ↓
                                                                              contractQC(contract) → findings
（日后 Phase 3 续:contract → archetype 摆 cell → 正交布线 → snapshot → auditPillars 复审）
```

新增**一个纯模块** `engine/design_contract.mjs`,导出两个纯函数:

- `synthesizeContract(roles, logical, opts?)` — 编译审计模型为 contract token。
- `contractQC(contract)` — 自洽校验,返回 findings 数组。

约束:无副作用、不可变(返回新对象)、确定性(全程排序、无随机、无 `Date.now`)。

## 4. token 词汇(通用合成 schema)

```jsonc
{
  "schemaVersion": 1,
  "grid": { "colPitch": <格>, "rowPitch": <格> },     // 无量纲基距
  "columns": [                                         // 把 left/center/right 泛化成有序 N 列
    { "id", "role", "order", "modules": [ids] }        // order: 0=最左输入 … 末=最右输出
  ],
  "modules": [
    { "id", "role", "column", "parts": [refs],
      "region": { "col", "row", "wCells", "hCells" },  // 列内抽象格矩形
      "gap": { "left", "right", "top", "bottom" } }     // 间距预算(格)
  ],
  "labelColumns": [                                     // 由网类 + 模块侧派生,替代手写
    { "id", "net", "module", "side": "left|right", "routeEnd": "from|to", "class": "signal" }
  ],
  "routingChannels": [
    { "id", "betweenColumns": ["a", "b"], "widthCells" }  // 列间总线通道
  ],
  "meta": { "controller", "moduleCount", "columnCount" }
}
```

### 派生规则(全部机械推导,无手写)

- **列**:`connector`/`regulator` → 输入列(order 0);`controller` → 中列;`switch`/`indicator`/`input`/`other` 负载 → 输出列。同 `column` 的模块归一列;列按 order 左→右排序。列 `order` 由「输入 < 控制 < 输出」固定优先级决定。
- **模块区**:`wCells`/`hCells` 由零件数 + 角色启发式给出(控制器宽、支撑细高);同列模块按 `row` 纵向堆叠,彼此留 `gap` 预算。
- **标签列**:仅 `signal` 类、且**跨模块**(引脚分布在 ≥2 个模块)的网 → 在对应模块侧出标签;源模块侧用 `routeEnd:"from"`、目标模块侧用 `routeEnd:"to"`,`side` 由该模块所在列相对对端列的左右关系决定。纯模块内部 signal 网与 `power`/`ground` 网**不**给标签列(后者走电源/地短桩)。
- **布线通道**:相邻列之间预留一条通道。

## 5. 自洽不变量(= 单测断言 + contractQC findings)

1. 每个模块恰好属于一列。
2. 列严格有序,控制器列位于输入/输出列之间。
3. 同列模块区在抽象格上不重叠(含 gap 预算)。
4. 每条跨模块(引脚分布在 ≥2 个模块)的 `signal` 网,被其每个端模块侧恰好一个 `labelColumn` 覆盖;无 `labelColumn` 引用不存在的网/模块。
5. 无 `power`/`ground` 网获得 `labelColumn`。
6. 确定性:同审计模型 → 逐字节相同 contract。

`contractQC` 把这 6 条编码为可门控 findings(为日后 `contract:synthesis` 门铺路),自身也被单测覆盖(含负例)。

## 6. 错误处理

- 纯函数、入口快失败,绝不静默吞错。
- 无控制器 → 无中列(合法,非错误)。
- 空模块 → 空 contract + 一条 INFO finding。
- 畸形输入(缺 `modules`/`parts`)→ 抛错。

## 7. 测试

- 新文件 `engine/design_contract.test.mjs`(node:test,中文用例名,贴合现有风格)。
- 复用 `role_infer.test.mjs` 的合成审计模型作输入。
- 断言:token 结构完整、6 条不变量、确定性(同输入两次调用深相等)、负例(故意构造重叠区/孤儿标签网 → `contractQC` 报 finding)。
- 目标:新单测并入现有 44 绿,**零回归**(`node --test engine/*.test.mjs` 全绿;`npm test` 与 `workflow:smoke`/`accept` 路径不受影响)。

## 8. 可选(不扩范围)

给 `bin/easyeda-plexus.mjs` 加一个**只读**子命令,从 `live.json` 经 `extract→infer→synthesize` 吐 `plexus_contract_report.json`,提供可跑产物。默认实现,保持只读、不写回。

## 9. 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `engine/design_contract.mjs` | 新增 | `synthesizeContract` + `contractQC` 纯函数 |
| `engine/design_contract.test.mjs` | 新增 | node:test 单测(正/负例 + 确定性) |
| `bin/easyeda-plexus.mjs` | 改(可选) | 只读 `contract` 子命令 → `plexus_contract_report.json` |

## 10. 验收标准

- `node --test engine/*.test.mjs` 全绿,测试数 > 44。
- `synthesizeContract` 对 `role_infer` 的样例审计模型产出满足全部 6 条不变量的 contract。
- `contractQC` 对合法 contract 返回空 findings,对注入缺陷的 contract 返回精确 finding。
- 现有 `npm test`、`workflow:smoke`、`accept` 本地路径无回归。

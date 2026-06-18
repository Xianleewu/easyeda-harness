# Plexus Phase 3 · support 端点 net 派生(slice 7)设计

- 日期:2026-06-18
- 范围:从网表派生 support-形模块两端的网(top/bottom),让真实图上的单件无源模块带电源/地桩。补全 slice 6(fanout pinNets)。
- 探针依据:真实 live.json 的 34 个 support 模块全是**单件**(0 链线),需要的是两端桩派生。

## 1. 决策(standing 批准)

`deriveSupportEndpoints(parts, logical)`:
- top = `parts[0]` 的 pin **'2'** 所在网(原型把首件 pin2 放最上)。
- bottom = `parts[末]` 的 pin **'1'** 所在网(末件 pin1 放最下)。
- 单件时 parts[0]===parts[末] → top=pin2 网、bottom=pin1 网。
- 与原型摆放几何**自洽**(不重排真实串联序——pre-existing 假设,本刀不碰)。

planLayout:带 `logical` 时为模块补 `nets.top`/`nets.bottom`,`opts.endpointNets` 优先、logical 补缺。support 原型按 class 出 powerStub(顶,power)/gndStub(底,ground);signal 端点不出桩。

## 2. 接口

```jsonc
netOfPin(designator, pinNum, logical) -> { name, class } | null   // 复用于 derivePinNets
deriveSupportEndpoints(parts, logical) -> { top?:{name,class}, bottom?:{name,class} }
```

planLayout(逐模块 nets 构造,带 logical 时):
```javascript
if (logical) {
  const sep = deriveSupportEndpoints(parts, logical);
  if (!nets.top && sep.top) nets.top = sep.top;
  if (!nets.bottom && sep.bottom) nets.bottom = sep.bottom;
}
```
(slice 6 的单件 pinNets 保留;fanout 用 pinNets,support 用 top/bottom。)

## 3. 测试

`engine/net_derive.test.mjs` 追加:
- `deriveSupportEndpoints`:2 件(R1.pin2→V5/power、R2.pin1→GND/ground)→ `{top:{V5,power},bottom:{GND,ground}}`;单件(C1.pin2→V3V3/power、C1.pin1→GND/ground)→ top/bottom 各取该脚网;空 parts → `{}`。

`engine/plexus_planner.test.mjs` 追加:
- 单件 support 模块(role='support',1 个 2 端件,pin2→power、pin1→ground)+ logical → 该模块 `wires>0 && netflags>0`;不传 logical 则裸件。组装 model 过真实 geomQC/labelQC hard=0。

真实 live.json 探针(手验):带 logical,support 模块出桩,统计 wires/flags 升、geomQC/labelQC 实况。

## 4. 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `engine/net_derive.mjs` | 改 | 加 `netOfPin`、`deriveSupportEndpoints`;`derivePinNets` 复用 `netOfPin` |
| `engine/net_derive.test.mjs` | 改 | `deriveSupportEndpoints` 单测 |
| `engine/plexus_planner.mjs` | 改 | 带 logical 补 top/bottom |
| `engine/plexus_planner.test.mjs` | 改 | 单件 support + logical 集成断言 |

## 5. 验收

- `deriveSupportEndpoints` 正确取两端网+类;单/多件均可。
- planLayout 带 logical 时 support 模块出 power/gnd 桩;不带向后兼容。
- 合成组装 model 过 geomQC/labelQC hard=0;并入套件零回归;`npm test` 100/100。
- 真实探针:support 模块不再全裸(手验记录)。

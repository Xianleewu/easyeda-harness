# Plexus Phase 3 · 网派生 derivePinNets(slice 6)设计

- 日期:2026-06-18
- 范围:从网表派生多引脚模块的 `pinNets`,并接进 planner,让 fanout 模块在真实图上真正扇出(当前 connector 落地后 0 线 0 标)。
- 不在本轮:support 链端点(top/bottom/side 哪端是电源/地/信号)的派生 —— 那有真实设计歧义,留待后续单独切片。

## 1. 决策(standing 批准)

只做**最无歧义的一刀**:`derivePinNets(component, logical)` —— 逐引脚在 `logical.nets` 里按 `designator.pinNum` 查其网名+类;未连引脚跳过。纯函数。接进 planner:单器件模块补 `nets.pinNets`,fanout 用、support 忽略。

## 2. 接口

```jsonc
derivePinNets(component, logical) -> { [pinNum]: { name, class } }
// component: { designator, pins:[{num,...}], ... }
// logical:   { nets:[{name, class, pins:['REF.PIN',...]}] }
// 规则:对每个 pin,key=`${designator}.${num}`;在 logical.nets 找首个 pins 含 key 的网 → {name:net.name, class:net.class};未连 → 不收。
```

planLayout 改动:
- 签名加可选 `logical`:`planLayout({ contract, byDes, logical, opts })`。
- 逐模块:若 `m.parts.length === 1 && logical`,设 `nets.pinNets = derivePinNets(parts[0], logical)`。其余 nets 构造(side/endpointNets)不变。
- fanout 读 `pinNets`;support 读 top/bottom/side(忽略 pinNets)→ planner 不按角色分支。
- 不传 logical 时行为完全不变(向后兼容现有 9 用例)。

## 3. 解耦/纯净

- `engine/net_derive.mjs` 纯函数,只读入参,确定性(按 component.pins 顺序)。
- planLayout 仅新增 import `derivePinNets` from `./net_derive.mjs`(引擎内,解耦生成轨道)。

## 4. 错误处理

- `derivePinNets`:component 无 pins → 返回 `{}`(空,非错误);畸形 logical(无 nets)→ 视作无网,返回 `{}`。
- 多网同引脚(理论上不应)→ 取首个匹配网(确定性)。

## 5. 测试

`engine/net_derive.test.mjs`:
- 合成 component(脚 1/2/3)+ logical(脚1→GND/ground、脚2→D-/signal、脚3 未连)→ 断言 `pinNets` 仅含脚 1/2,类正确,脚 3 不收。
- 空 pins / 无 nets → `{}`。
- 确定性。

`engine/plexus_planner.test.mjs` 追加:
- 单件 fanout(connector,role='connector')模块 + logical → `planLayout` 产出该模块有 `wires.length>0 && netflags.length>0`(pinNets 被填、fanout 扇出);不传 logical 则该模块 0 线 0 标(向后兼容)。
- 组装 model 过真实 geomQC/labelQC hard=0(合成几何受控)。

真实 live.json 探针(交付手验):带 logical 跑 planLayout,connector 模块 `wires/flags > 0`;报告 geomQC/labelQC 实况(若真实密脚连接器触发净空 hard,如实记录为 follow-up,不在本刀强行解决)。

## 6. 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `engine/net_derive.mjs` | 新增 | `derivePinNets` 纯函数 |
| `engine/net_derive.test.mjs` | 新增 | 单测 |
| `engine/plexus_planner.mjs` | 改 | 可选 `logical`,单件模块补 `pinNets` |
| `engine/plexus_planner.test.mjs` | 改 | 集成断言(带/不带 logical) |

## 7. 验收

- `derivePinNets` 正确映射引脚→网+类、跳过未连。
- planLayout 带 logical 时单件 fanout 模块扇出有线有标;不带时向后兼容。
- 合成组装 model 过真实 geomQC/labelQC hard=0;并入套件零回归;`npm test` 100/100。
- 真实探针:connector 不再 0 线 0 标(手验记录)。

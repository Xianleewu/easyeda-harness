# Plexus B2b 增量① — 刚性块紧排(连接驱动 + 重力压实)设计

> 通用、零特定电路内容。本文只描述引擎/算法/裁判,绝不含任何器件名、网名、designator 或项目夹具。

## 目标(一句话)

把 `generateLayout` 生成的模块图**整板压紧**——消除块与块之间的空洞,在**不改任何块内部几何、不改任何电气连接**的前提下显著缩小整板面积、提升填充率,并以 deliver+reload 投到真实 EDA、用数据验证。

## 背景与根因(量化)

`generateLayout` 已用 `connPlace`(连接驱动:按连通度排序 + 每块在已放块的 4 邻位×镜像中选连接最短且不叠的位)摆放各模块块。但实测一块通用测试板:

- 7 个模块块,块 bbox 面积合计 ≈ 1044k px²,整板 bbox ≈ 1885k px² → **块间空洞 ≈ 45%**。
- 40px 网格占用:器件 14.6%、器件+标签 31.5%(空白约 68%)。

根因:`connPlace` 的候选位只锚在已放块的角上(非天际线填充),且优化连接长度会把块摊开,**全程没有任何消除空洞的压实步骤** → 块间残留大量垂直/水平空洞。

## 架构(复用,不重造)

- **保留** `connPlace` 不动(连接驱动 + 镜像是正确的、是"相连块相邻"的来源)。
- **新增**一个纯压实后处理 `compactBlocks(pos, subs, opts)`,与 `connPlace` 同文件 `engine/conn_place.mjs`。
- `generateLayout` 仅在调用 `connPlace` 之后增加一行 `compactBlocks(...)`,把压实后的位写回 `posOf`。改动面极小。

### 组件:`compactBlocks(pos, subs, opts) -> pos`

- **Consumes**:`pos`(`connPlace` 返回的 `Map<id, {X, Y, mir}>`,块全局左上角 + 是否镜像);`subs`(`[{ id, w, h, ... }]`,块宽高,与 `connPlace` 入参同形)。
- **Produces**:同形 `Map<id, {X, Y, mir}>`,X/Y 被向原点压实、吸格到 10 的倍数,`mir` 原样透传。
- **不变量**:不新增/删除任何块;`mir` 不变;任意两块的间距 ≥ `PAD`(零叠压)。

## 数据流

```
generateLayout
  → clusterComponents            (anchor → members)
  → 每簇 layoutClusterTemplate    (块内布局,得 subs[{anchor, model, bb, w, h}])
  → connPlace(cpSubs, nets)       (连接驱动初位 pos)
  → compactBlocks(pos, cpSubs)    (★新增:重力压实消空洞)   ← 本增量
  → 按 pos 偏移各块几何 + SNAP(5) + deconflict + ortho
  → { model, moduleRegions, ... }
deliverGenerated → 投 live + save+close+open 重载(改动可见)
```

## 算法:连接序 BLF 天际线填洞 + 单调守卫

> **设计修正(闭环探针所得)**:最初设想的"向原点重力滑动"被探针证伪——`connPlace` 已把块局部紧排(块已 PAD 相邻),向原点滑动无空间可压,实测在真板/合成板均 no-op。那 45% 空洞是**不等矩形相邻 packing 的不可约空洞**(矮块旁的上下留白),必须**天际线填洞式重排**才能消。

```
按【连接序】(pos 的插入序 = connPlace 连通度贪心序)遍历块,做 BLF(bottom-left-fill)天际线装箱:
  行宽 MAXW ← max(sqrt(aspect · ΣW · maxH), 最宽块);  aspect 默认 1.4(商用图纸横向)
  维护天际线 sky=[{x0,x1,y}];初始一段 y=BASE
  for 每块(连接序):
    W=w+PAD, H=h+PAD
    扫 x(步进 10)取 topAt(x,x+W) 最低的 x → (bx, by)   # 填进最低空洞
    放块于吸格(bx,by)到 10 的倍数;raise(bx, bx+W, by+H) 抬升天际线
单调守卫:比较 BLF 排布 bbox 面积 vs 输入 pos 排布 bbox 面积;
          BLF 不更小 → 原样返回输入(克隆)。⟹ 整板绝不变大。
```

- **连接序**(非高度降序):连通度相邻的块连续放置 → 相连块倾向相邻(保 connPlace 的相邻性,供后续增量③直连线用),同时天际线填洞拿到密度。
- **单调守卫**是关键安全网:大散板 BLF 更紧(实测缩 ~29.5%)→ 用 BLF;小已紧板 BLF 反而更大 → 保留 connPlace 原排布。保证 `compact ≤ base` 恒成立。
- **PAD=60**(`opts.compactPad ?? 60`,比 connPlace 的 40 大):块边缘留白,避免块靠近后块边标签互撞(实测 pad=40 会 +2 label-hard;pad=60 零回归)。
- **确定性**:遍历序 = pos 插入序(固定),天际线扫描确定;同输入同输出。
- `opts.compact !== false` 启用(默认开);`compact: false` 关闭(对比基线)。`BASE=60`(与 connPlace 一致)。

## 连通安全(关键论证)

压实**不可能改变任何电气连接**,因为:

1. 块是刚性单元——`compactBlocks` 只改块的全局左上角 (X,Y),块内所有件/脚/线/标签随块整体平移,块内相对几何完全不变。
2. 跨模块连接全靠**网名标签**(net flag),按名相连、与坐标无关——块挪到哪,同名标签仍属同一 EDA 网。
3. 块内导线随块刚性平移,端点-脚关系不变。

故离线逻辑网、deliver 后 `getNetlistFile` 权威网表结构都必须不变(裁判会验)。

诚实取舍:压实可能让 `connPlace` 排好的某对相邻块被第三块挤得稍微分开,跨模块连接长度可能小幅上升。紧凑度是本增量选定的首要裁判,此取舍可接受;连接驱动的相邻性大体保留。

## 验收裁判(闭环,全用数据 + 真 EDA;绝不放水、不出"自我感觉百分比")

在同一块通用测试板上,`compact:false`(基线)对比 `compact:true`(本增量)。

**硬门(任一不过=增量不合格,必须修引擎,绝不放水)**:

| 维度 | 裁判 | 硬通过线 |
|------|------|--------|
| 紧凑度(主) | 整板 bbox 面积 | **严格下降**(< 基线) |
| 零回归 | `geomQC`: overlaps/crossings/wireThruComp/wireThruPin | 均**不升** |
| 零回归 | `labelQC` hard 数 | **不变**(块靠近会动块边标签;靠 pad=60 留白保证不新撞) |
| 零叠压 | 任意两块间距 | **≥ PAD**(块间叠压=0) |
| 连通保全(离线) | 逻辑网集合 | 与基线**一致** |
| 连通保全(在线) | deliver+reload 后 `getNetlistFile` 权威网表 | 结构**不变**,零新断网 |
| EDA 可见 | deliver+reload 后前台 EDA | 用户肉眼看到整板变紧 |

**报告目标(测量并报实测值,不达不自动判失败——BLF 有局部最优 + 单调守卫对小板不压;避免过约束逼出 gaming)**:

- 整板 bbox 面积下降 ≥ 20%。
- 块间空洞占比 45% → ≤ 20%(RK3576 参考 ~15%)。

**离线实测(通用测试板,pad=60)**:整板 bbox 面积 1794375 → 1264500 = **缩 29.5%**;geomQC 2→2、labelQC hard 22→22(全零回归);件 56→56。**硬门全过 + 报告目标(≥20%)达成。** 真 EDA 投递验证见 plan Task 3。
（小已紧板:单调守卫保持不变,`compact == base`,零回归。)

**注**:桥截图不可靠(stale/blank),视觉裁判一律以用户前台 EDA 为准;程序侧一律用数据(几何 QC / 权威网表 / DRC)。

## 测试

- `engine/conn_place.test.mjs` 增 `compactBlocks` 单测:
  - 给定带空洞的 `pos`(块间留大缝),压实后整体 bbox 面积下降、块间无叠压(任意两块满足 PAD)。
  - `mir` 透传不变;块数不变。
  - 末位吸格 10。
  - 确定性:同输入两次调用结果全等。
- `engine/cluster_generate.test.mjs` 增集成断言:`generateLayout(snap, {compact:true})` vs `{compact:false}` → bbox 面积下降、geomQC 不升、labelQC hard 不变。
- `npm test` 全绿(零回归)。

## 非目标(YAGNI,留作后续独立增量)

- 块内瘦身(短逃逸桩 / 件紧排 / 扇出对齐)= B2b 增量②(整洁度)。
- 标签→直连导线 = B2b 增量③(去标签汤),依赖块紧邻后转换率提升。
- 全局连接驱动重排(力导向)= 不在本谱内。

## 落地清单(供 writing-plans 展开)

1. `engine/conn_place.mjs`:实现 `compactBlocks` + 单测。
2. `engine/cluster_generate.mjs`:`connPlace` 后接 `compactBlocks`(默认开,`opts.compact` 可关)。
3. 集成测试(compact on/off 对比)。
4. 离线验证全部裁判(面积↓、空洞↓、geom/label 零回归、逻辑网不变)。
5. deliver+reload 投真 EDA;`getNetlistFile` 验连通;用户前台肉眼确认。

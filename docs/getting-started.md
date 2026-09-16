# 安装与首次运行

这套工具有两部分：本仓库负责确定性检查、候选编译和受保护写入；官方
`easyeda-api-skill` 提供 Bridge 与 EasyEDA 端 API Gateway 扩展。只克隆本仓库不能控制 EasyEDA。

## 1. 安装本仓库

要求 Node.js 20 或更高版本、Git，以及 EasyEDA 专业版桌面客户端。

```bash
git clone https://github.com/Xianleewu/easyeda-harness.git
cd easyeda-harness
npm ci
npm run doctor:offline
```

`doctor:offline` 必须显示 Node 和 dependencies 两项均为 `✓`。`npm ci` 是可复现安装入口；
不要用一个会改写锁文件的 `npm install` 掩盖依赖漂移。

## 2. 安装 Bridge 和 EasyEDA 扩展

```bash
git clone https://github.com/easyeda/easyeda-api-skill ~/.local/share/easyeda-api-skill
npm --prefix ~/.local/share/easyeda-api-skill install
export EASYEDA_API_SKILL_DIR="$HOME/.local/share/easyeda-api-skill"
```

在 EasyEDA 中安装并启用
[API Gateway 扩展](https://jlc-ext.com/item/oshwhub/run-api-gateway)。在一个单独的终端启动 Bridge：

```bash
cd easyeda-harness
EASYEDA_API_SKILL_DIR="$HOME/.local/share/easyeda-api-skill" npm run bridge
```

打开目标原理图，再在另一个终端核验完整链路：

```bash
npm run doctor
```

五项都为 `✓` 才表示 Node、依赖、API skill、Bridge 和 EasyEDA 窗口均已就绪。Bridge 正常但
`eda` 为 `✗` 时，问题在 EasyEDA 扩展尚未载入或未连接，不要反复重启 Bridge。

## 3. 为每个项目建立私有证据文件

模块划分、连接器针脚协议、差分对和无源件电气依据属于具体电路，不能提交到这个公共仓库。
先在仓库外生成模板：

```bash
npm run evidence:init -- "$HOME/Documents/my-board/token-evidence.json"
```

编辑所有 `REPLACE_*` 值：

- `moduleRegions`：每个装配器件恰好属于一个功能模块；
- `cellRegions`：每个装配器件恰好属于一个模块内功能单元；
- `sheetBounds` / `titleBlockKeepout`：当前图页和右下角信息栏的真实边界；
- 有连接器时填写语义、封装和跨引脚拓扑证据；
- 有差分网络时填写端点、极性和约束；
- 每个 R/C/L 都给出可追溯的数据手册依据和已核验封装源。

模板只保证文件结构可以被读取，不代表设计已经通过。禁止为了变绿而填写虚构的 `PASS`。
第一次 lint 会把缺失证据按对象列出。

## 4. 三种使用方式

### 只读审计已有原理图

```bash
export EASYEDA_TOKEN_EVIDENCE="$HOME/Documents/my-board/token-evidence.json"
export EASYEDA_ARTIFACT_DIR="$HOME/.local/share/easyeda-harness/my-board"
npm run wf -- lint
```

结果写入仓库外的 `workflow-context.json` 和 `workflow-lint.json`。lint 即使返回非零，也会在取证完整时
给出按根因排序的对象、坐标和修复队列；非零表示当前板未达标。

### 提交一个受保护的修复变换

变换文件也应放在项目私有目录。先离线编译，绿后才允许触碰 live 文档：

```bash
npm run compile -- /absolute/path/fix.mjs
npm run wf -- commit /absolute/path/fix.mjs
npm run wf -- audit
```

不超过 25 个装配件、且变换实现了 `stage` 和 `validate` 合同的板，可用一键轨道：

```bash
npm run wf -- quick /absolute/path/fix.mjs
```

它固定执行 fresh lint → offline compile → 一次提交 → 一次最终截图；任一步失败立即停止。

### 对快照生成全新布局

```bash
npm run live:save
node bin/plexus.mjs layout live.json out.png
node bin/plexus.mjs deliver live.json
```

这是布局生成路径。已有商业原理图的局部清理优先使用 `wf lint/compile/commit/audit`，以保留经过核验的
符号、封装和电气身份。

## 5. 给 AI Agent 的启动提示

```text
在 easyeda-harness 仓库工作。先逐行读取 AGENTS.md 和
docs/workflow-review-2026-09-15.md，运行 npm run doctor 与 wf lint，
只从 workflow-context.json 的完整根因队列形成候选。任何 live 写入前必须先通过 compile；
不得把当前电路的器件、网络或证据提交到公共仓库。
```

常见问题：

- `npm ci` 失败：锁文件与 `package.json` 不一致，是仓库缺陷，不应改用 `npm install` 绕过。
- `bridge not found`：运行 `npm run bridge`，或设置 `EASYEDA_API_SKILL_DIR`。
- Bridge 正常但无窗口：在 EasyEDA 里载入 API Gateway 扩展并打开原理图。
- `EASYEDA_TOKEN_EVIDENCE is required`：先生成并填写项目私有证据文件。
- receipt stale：源码、规则或证据已变化；重新运行 `wf lint`，不要复用旧回执。

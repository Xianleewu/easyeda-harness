# Installation and first run

This repository contains the deterministic checks, candidate compiler, and guarded write path. The official
`easyeda-api-skill` supplies the Bridge and the EasyEDA API Gateway extension. Both are required for live use.

```bash
git clone https://github.com/Xianleewu/easyeda-harness.git
cd easyeda-harness
npm ci
npm run doctor:offline

git clone https://github.com/easyeda/easyeda-api-skill ~/.local/share/easyeda-api-skill
npm --prefix ~/.local/share/easyeda-api-skill install
export EASYEDA_API_SKILL_DIR="$HOME/.local/share/easyeda-api-skill"
npm run bridge                    # keep this terminal open
```

Install and load the [API Gateway extension](https://jlc-ext.com/item/oshwhub/run-api-gateway) in EasyEDA,
open a schematic, and run `npm run doctor` in another terminal. All five checks must pass.

Each circuit needs a private evidence file outside this public repository:

```bash
npm run evidence:init -- "$HOME/Documents/my-board/token-evidence.json"
```

Replace every placeholder with reviewed module/cell membership, sheet and title-block bounds, and any required
connector, high-speed, and passive evidence. The template is loadable, not pre-approved; never invent a `PASS`.

Read-only audit:

```bash
export EASYEDA_TOKEN_EVIDENCE="$HOME/Documents/my-board/token-evidence.json"
export EASYEDA_ARTIFACT_DIR="$HOME/.local/share/easyeda-harness/my-board"
npm run wf -- lint
```

Guarded repair:

```bash
npm run compile -- /absolute/path/fix.mjs
npm run wf -- commit /absolute/path/fix.mjs
npm run wf -- audit
```

For a board with at most 25 fitted parts and a transform that implements `stage` and `validate`:

```bash
npm run wf -- quick /absolute/path/fix.mjs
```

Snapshot layout generation remains available through `npm run live:save`, `node bin/plexus.mjs layout`, and
`node bin/plexus.mjs deliver`. Use the guarded workflow for incremental cleanup of an existing verified design.

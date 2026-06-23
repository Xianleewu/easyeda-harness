# Claude Code Instructions

**永远不要在本工程中包含任何特定电路图的信息。** 这是一个**通用、公共的工具**:用户安装后,
它帮助用户**设计 / 美化任意电路图**——像前端设计工作流,但面向原理图。一切用**角色 / 模式**
泛化,绝不硬编码任何特定电路的器件名、网名、模块标题或项目夹具。任何与单一电路绑定的字面量都是缺陷。

Use `AGENTS.md` as the source of truth.

In short:

1. Install/start <https://github.com/easyeda/easyeda-api-skill> for live EasyEDA access; open **any**
   schematic in EasyEDA Pro.
2. `npm install`.
3. `npm run live:save` — capture the open board to `live.json` (works for any board).
4. `node bin/plexus.mjs layout live.json out.png` — any board → commercial 2D layout + render + gates.
5. `node bin/plexus.mjs deliver live.json` — deliver the layout to the live EasyEDA document.
6. `npm test` — run the generic test suite.

## Generic engines (zero specific-circuit content)

`engine/role_infer.mjs` (role classification) · `circuit_packs/archetypes/` (role-based cells) ·
`engine/cell_helpers.mjs` (orthogonal primitives, fail-fast) · `engine/cluster_generate.mjs`
(auto-cluster + schematic-aware layout) · `engine/module_repack.mjs` (2D commercial arrangement) ·
`engine/geom_qc.mjs` / `engine/label_qc.mjs` (gates) · `engine/sheet_renderer.mjs` (render).

## Design language

`docs/schematic-design-rules.md` (DR1–DR18 measurable gates) and `docs/schematic_design_rulebook.md`
(the project-agnostic design language). Commercial delivery target: EasyEDA DRC `0/0/0/0`.

When a gate fails, fix the generic engine / archetype / cell-helper — **never** by adding any
circuit-specific content.

const project = await eda.dmt_Project.getCurrentProjectInfo().catch(() => null);
const document = await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(() => null);
const schematic = await eda.dmt_Schematic.getCurrentSchematicInfo().catch(() => null);
const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo().catch(() => null);

return {
  project,
  document,
  schematic,
  page,
  location: typeof location !== 'undefined' ? location.href : '',
};

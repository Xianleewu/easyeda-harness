export function validateTargetContext(ctx, opts = {}) {
	const expectedProject = opts.expectedProject || process.env.EASYEDA_EXPECTED_PROJECT || '';
	const findings = [];
	const projectName = ctx?.project?.friendlyName || ctx?.project?.name || '';
	const projectUuid = ctx?.project?.uuid || '';
	const documentUuid = ctx?.document?.uuid || '';
	const documentType = ctx?.document?.documentType;
	const documentProjectUuid = ctx?.document?.parentProjectUuid || '';
	const schematicUuid = ctx?.schematic?.uuid || '';
	const schematicProjectUuid = ctx?.schematic?.parentProjectUuid || '';
	const pageUuid = ctx?.page?.uuid || '';
	const pageSchematicUuid = ctx?.page?.parentSchematicUuid || '';

	function hard(rule, msg, where = {}) {
		findings.push({ rule, severity: 'hard', category: 'target', msg, where });
	}

	if (expectedProject && projectName !== expectedProject) {
		hard('T1-target-project-name', `current project must be ${expectedProject}`, { expectedProject, projectName });
	}
	if (!projectUuid || !documentUuid || !schematicUuid || !pageUuid) {
		hard('T2-target-uuid-present', 'target project/document/schematic/page UUIDs must all be present', {
			projectUuid: !!projectUuid,
			documentUuid: !!documentUuid,
			schematicUuid: !!schematicUuid,
			pageUuid: !!pageUuid,
		});
	}
	if (documentType !== 1) {
		hard('T3-target-document-type', 'current document must be a schematic page', { documentType });
	}
	if (projectUuid && documentProjectUuid && projectUuid !== documentProjectUuid) {
		hard('T4-target-document-project', 'current document must belong to the current project', { projectUuid, documentProjectUuid });
	}
	if (projectUuid && schematicProjectUuid && projectUuid !== schematicProjectUuid) {
		hard('T5-target-schematic-project', 'current schematic must belong to the current project', { projectUuid, schematicProjectUuid });
	}
	if (documentUuid && pageUuid && documentUuid !== pageUuid) {
		hard('T6-target-document-page', 'current document UUID must match current schematic page UUID', { documentUuid, pageUuid });
	}
	if (schematicUuid && pageSchematicUuid && schematicUuid !== pageSchematicUuid) {
		hard('T7-target-page-schematic', 'current page must belong to the current schematic', { schematicUuid, pageSchematicUuid });
	}

	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		findings,
		summary: { projectName, documentType, projectUuid, documentUuid, schematicUuid, pageUuid },
	};
}

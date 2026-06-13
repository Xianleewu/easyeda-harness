export function isBundledAihwdebuggerRegistry(registry) {
	const assembly = registry?.assembly || registry || {};
	return assembly?.circuitPack === 'aihwdebugger' || assembly?.projectId === 'easyeda-harness-default';
}

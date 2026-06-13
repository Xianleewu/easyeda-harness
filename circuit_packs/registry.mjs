import { pack as aihwdebugger } from './aihwdebugger/pack.mjs';

const PACKS = new Map([
	[aihwdebugger.id, aihwdebugger],
]);

export function getCircuitPack(id = 'aihwdebugger') {
	const pack = PACKS.get(id || 'aihwdebugger');
	if (!pack) throw new Error(`Unknown circuit pack: ${id}`);
	return pack;
}

export function circuitPackIds() {
	return [...PACKS.keys()];
}

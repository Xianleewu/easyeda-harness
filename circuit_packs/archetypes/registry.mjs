// 角色原型注册表:role -> 原型 fn;renderArchetype 薄分发。
import { supportArchetype } from './support.mjs';
import { fanoutArchetype } from './fanout.mjs';
import { densefanoutArchetype } from './densefanout.mjs';

const ARCHETYPES = {
	support: supportArchetype,
	indicator: supportArchetype,
	input: supportArchetype,
	connector: fanoutArchetype,
	controller: densefanoutArchetype,
	ic: densefanoutArchetype,
	regulator: densefanoutArchetype,
};

export function getArchetype(role) {
	const fn = ARCHETYPES[role];
	if (!fn) {
		throw new Error(`getArchetype: unknown role '${role}' (have: ${Object.keys(ARCHETYPES).join(', ')})`);
	}
	return fn;
}

export function renderArchetype(role, spec) {
	return getArchetype(role)(spec);
}

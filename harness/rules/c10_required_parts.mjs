import { REQUIRED_PARTS } from '../module_registry.mjs';

export function c10RequiredParts(m) {
	const F = [];
	const refs = new Set(m.parts.map(p => p.designator).filter(Boolean));
	for (const ref of REQUIRED_PARTS) {
		if (!refs.has(ref)) F.push({
			rule: 'C10.1-required-part-missing',
			severity: 'hard',
			category: 'integrity',
			msg: `Required component is missing: ${ref}`,
			where: { ref },
		});
	}
	for (const ref of refs) {
		if (!REQUIRED_PARTS.includes(ref)) F.push({
			rule: 'C10.2-unexpected-part',
			severity: 'hard',
			category: 'integrity',
			msg: `Unexpected component is present: ${ref}`,
			where: { ref },
		});
	}
	return F;
}

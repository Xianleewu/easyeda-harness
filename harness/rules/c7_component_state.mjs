export function c7ComponentState(m) {
	const F = [];
	const allowedNetports = new Set(['USB_CC1', 'USB_CC2']);
	for (const p of m.netports || []) {
		if (allowedNetports.has(p.net)) continue;
		F.push({
			rule: 'C7.5-pointed-netport',
			severity: 'hard',
			category: 'state',
			msg: `Pointed net port is not allowed: ${p.net}`,
			where: { net: p.net, x: p.x, y: p.y },
		});
	}
	for (const p of m.parts) {
		if (p.addIntoBom === false || p.addIntoPcb === false) {
			F.push({
				rule: 'C7.1-component-disabled',
				severity: 'hard',
				category: 'state',
				msg: `${p.designator}(${p.name}) is excluded from BOM/PCB`,
				where: { designator: p.designator, addIntoBom: p.addIntoBom, addIntoPcb: p.addIntoPcb },
			});
		}

		for (const attr of p.attrs || []) {
			const key = String(attr.key || '');
			if (!key || key === 'Designator') continue;
			if (key === 'Value' && !String(attr.value || '').trim()) {
				F.push({
					rule: 'C7.3-empty-value',
					severity: 'hard',
					category: 'state',
					msg: `${p.designator} has empty Value attribute`,
					where: { designator: p.designator },
				});
			}
			if (['Supplier', 'Supplier Part', 'Manufacturer', 'Manufacturer Part'].includes(key) && String(attr.value || '').trim()) {
				F.push({
					rule: 'C7.4-standardization-field',
					severity: 'hard',
					category: 'state',
					msg: `${p.designator} has non-empty ${key}: ${attr.value}`,
					where: { designator: p.designator, key, value: attr.value || '' },
				});
			}
			if (attr.keyVisible === true || attr.valueVisible === true) {
				F.push({
					rule: 'C7.2-visible-part-attr',
					severity: 'hard',
					category: 'state',
					msg: `${p.designator} has visible non-designator attribute: ${key}`,
					where: { designator: p.designator, key, value: attr.value || '', keyVisible: attr.keyVisible, valueVisible: attr.valueVisible, x: attr.x, y: attr.y },
				});
			}
		}
	}
	return F;
}

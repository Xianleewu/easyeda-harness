const names = new Set([
	'USB_DN', 'USB_DP', 'RESET_EN', 'BOOT_IO9', 'EXT_PWR_EN',
	'RELAY1_EN', 'RELAY2_EN', 'PMOS_GATE', 'PGATE_PULL',
	'Q2_GATE', 'RLY1_GATE', 'RLY1_COIL_A', 'RLY1_COIL_V',
	'RLY2_GATE', 'RLY2_COIL_A', 'RLY2_COIL_V',
]);
const ids = await eda.sch_PrimitiveText.getAllPrimitiveId().catch(() => []) || [];
const kill = [];
for (const id of ids) {
	const t = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id).catch(() => null);
	const content = t && (t.content || (t.getState_Content && t.getState_Content()));
	if (names.has(String(content || ''))) kill.push(id);
}
if (kill.length) await eda.sch_PrimitiveText.delete(kill);
return { deleted: kill.length };

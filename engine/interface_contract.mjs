export const INTERFACE_CONTRACTS = [
	{
		net: 'RESET_EN',
		from: 'btn1',
		to: 'mcu',
		mode: 'local-support-to-controller',
		allowed: 'visible-or-grouped-contract',
		reason: 'Reset support is a local user-input cell serving the MCU EN pin.',
	},
	{
		net: 'BOOT_IO9',
		from: 'btn2',
		to: 'mcu',
		mode: 'local-support-to-controller',
		allowed: 'visible-or-grouped-contract',
		reason: 'Boot support is a local user-input cell serving the MCU boot pin.',
	},
	{
		net: 'EXT_PWR_EN',
		from: 'mcu',
		to: 'pmos',
		mode: 'controller-to-output',
		allowed: 'visible-or-grouped-contract',
		reason: 'MCU controls the high-side power switch.',
	},
	{
		net: 'RELAY1_EN',
		from: 'mcu',
		to: 'relay1',
		mode: 'controller-to-output',
		allowed: 'visible-or-grouped-contract',
		reason: 'MCU controls relay channel 1.',
	},
	{
		net: 'RELAY2_EN',
		from: 'mcu',
		to: 'relay2',
		mode: 'controller-to-output',
		allowed: 'visible-or-grouped-contract',
		reason: 'MCU controls relay channel 2.',
	},
	{
		net: 'USB_DN',
		from: 'usb',
		to: 'mcu',
		mode: 'paired-high-speed-interface',
		allowed: 'paired-grouped-contract',
		pair: 'USB_D',
		reason: 'USB D- should read as part of the USB D± pair between connector conditioning and MCU.',
	},
	{
		net: 'USB_DP',
		from: 'usb',
		to: 'mcu',
		mode: 'paired-high-speed-interface',
		allowed: 'paired-grouped-contract',
		pair: 'USB_D',
		reason: 'USB D+ should read as part of the USB D± pair between connector conditioning and MCU.',
	},
];

export function interfaceContractByNet() {
	return new Map(INTERFACE_CONTRACTS.map(x => [x.net, x]));
}

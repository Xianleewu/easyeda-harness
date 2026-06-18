// 网派生(纯函数):多引脚器件的每个引脚 → 其所在网的名+类。
// 用于 fanout 原型的 pinNets。未连引脚不收。

export function derivePinNets(component, logical) {
	const out = {};
	const pins = (component && component.pins) || [];
	const nets = (logical && logical.nets) || [];
	const des = component && component.designator;
	for (const p of pins) {
		const key = `${des}.${p.num}`;
		const net = nets.find(n => (n.pins || []).includes(key));
		if (net) out[String(p.num)] = { name: net.name, class: net.class };
	}
	return out;
}

// 网派生(纯函数):器件引脚 → 其所在网的名+类。
function netOfPin(designator, num, logical) {
	const key = `${designator}.${num}`;
	const net = ((logical && logical.nets) || []).find(n => (n.pins || []).includes(key));
	return net ? { name: net.name, class: net.class } : null;
}

// 多引脚器件:每个引脚 → 网+类(fanout 用)。未连引脚不收。
export function derivePinNets(component, logical) {
	const out = {};
	const pins = (component && component.pins) || [];
	const des = component && component.designator;
	for (const p of pins) {
		const net = netOfPin(des, p.num, logical);
		if (net) out[String(p.num)] = net;
	}
	return out;
}

// support 链:首件 pin2(顶)、末件 pin1(底)→ 端点网+类(support 用)。
export function deriveSupportEndpoints(parts, logical) {
	if (!Array.isArray(parts) || !parts.length) return {};
	const out = {};
	const top = netOfPin(parts[0].designator, '2', logical);
	const bottom = netOfPin(parts[parts.length - 1].designator, '1', logical);
	if (top) out.top = top;
	if (bottom) out.bottom = bottom;
	return out;
}

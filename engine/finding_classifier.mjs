// 通用 DRC finding 分类器（纯函数，无副作用、无桥依赖）
//
// 输入：drc_report.json（{ drc: { items: [{ level, msg }] } }）
// 输出：逐条分类的 finding + 汇总。disposition 四态：
//   auto    安全确定，自动改（残留未连网标 → 删）
//   resolve 需 resolver 查库再定（器件标准化 → lib_Device.search）
//   ask     需人工判定（悬空引脚 漏连 vs NC），附启发式预填建议
//   skip    未识别类别，不自动处理
//
// 设计意图：把"能自动判的"与"必须问人的"在纯逻辑层先分开，
// 让实时写边界只消费已判定结果，模糊项绝不自动猜。

const REASON = {
	auto: '残留未连网标，安全删除',
	resolve: '需 lib_Device.search 确定唯一标准件：唯一命中自动重绑，否则交互选型',
	ask: '引脚悬空：需确认真实漏连(补连线)还是有意 NC(加非连接标识)',
	skip: '未识别 DRC 类别，跳过自动处理',
};

/* 类别判定：与 live_audit.categorizeDrc 同源规则 */
function categoryOf(msg) {
	if (/器件标准化|供应商编号不匹配/.test(msg)) return 'deviceStandardization';
	if (/引脚悬空|非连接标识/.test(msg)) return 'floatingPin';
	if (/没有连接导线|未连接/.test(msg)) return 'unconnectedNetLabel';
	return 'other';
}

/* 网络标识 $3I165 没有连接导线或总线。→ '$3I165' */
function parseNetLabels(msg) {
	const out = [];
	const re = /网络标识\s+(\S+)\s+没有连接/g;
	let m;
	while ((m = re.exec(msg)) !== null) out.push(m[1]);
	return out;
}

/* 建议使用器件标准化: SW2($3I6),LED6($3I7) → [{designator,edaId}] */
function parseDevicePairs(msg) {
	const out = [];
	const re = /([A-Za-z]+\d+)\((\$[^)]+)\)/g;
	let m;
	while ((m = re.exec(msg)) !== null) out.push({ designator: m[1], edaId: m[2] });
	return out;
}

/* ...非连接标识在引脚上 : SW2.B,LED6.1,... → ['SW2.B', ...] */
function parsePins(msg) {
	const tail = msg.includes(':') ? msg.slice(msg.lastIndexOf(':') + 1) : msg;
	return tail.split(/[,，]/).map(s => s.trim())
		.filter(s => /^[A-Za-z]+\d+\.[A-Za-z0-9]+$/.test(s));
}

/* 悬空引脚启发式预填：复现人工分诊，仍交人确认 */
function suggestForPin(ref, floatCountByDesignator) {
	const designator = ref.slice(0, ref.indexOf('.'));
	if (/^R\d/.test(designator)) return 'wire';                 // 电阻悬空 → 疑似漏连
	if (/^C\d/.test(designator) && floatCountByDesignator[designator] >= 2) return 'wire'; // 电容两脚都悬空
	return 'nc';                                                // 其余 → NC 候选
}

export function classifyFindings(drcReport) {
	const items = drcReport?.drc?.items || drcReport?.items || [];
	const classified = [];

	for (const it of items) {
		const msg = it?.msg || '';
		const category = categoryOf(msg);

		if (category === 'unconnectedNetLabel') {
			for (const net of parseNetLabels(msg)) {
				classified.push({ category, kind: 'delete-net-label', ref: net, disposition: 'auto', reason: REASON.auto });
			}
		} else if (category === 'deviceStandardization') {
			for (const p of parseDevicePairs(msg)) {
				classified.push({ category, kind: 'standardize-device', ref: p.designator, detail: { edaId: p.edaId }, disposition: 'resolve', reason: REASON.resolve });
			}
		} else if (category === 'floatingPin') {
			const pins = parsePins(msg);
			const countBy = {};
			for (const ref of pins) {
				const d = ref.slice(0, ref.indexOf('.'));
				countBy[d] = (countBy[d] || 0) + 1;
			}
			for (const ref of pins) {
				classified.push({ category, kind: 'floating-pin', ref, disposition: 'ask', suggestion: suggestForPin(ref, countBy), reason: REASON.ask });
			}
		} else {
			classified.push({ category: 'other', kind: 'unknown', ref: msg.slice(0, 40), disposition: 'skip', reason: REASON.skip });
		}
	}

	const summary = { auto: 0, resolve: 0, ask: 0, skip: 0, total: classified.length };
	for (const c of classified) summary[c.disposition]++;
	return { items: classified, summary };
}

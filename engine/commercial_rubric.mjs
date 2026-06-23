// 商用级原理图规则集(冻结)。阈值源自商用参考图实测标定,见 spec §7.1。零特定电路内容。

export const THRESHOLDS = {
	GRID: 5,                    // 引脚吸附栅格(EDA 单位)
	GRID_SNAP_MIN_PCT: 95,      // CR-03
	ORTHO_MIN_PCT: 94,          // CR-02 原始线段正交率下限
	ROT_ALLOWED: [0, 90, 180, 270], // CR-04
	MIRROR_MAX_PCT: 5,          // CR-04 镜像占比上限(实测<1%,留余量)
	SPACING_MIN: 15,            // CR-05 最近邻最小中心距
	SPACING_MED_LO: 25,         // CR-05 中位下限(不太挤)
	SPACING_MED_HI: 90,         // CR-05 中位上限(不太散)
	LABEL_TO_LINE_MED_MAX: 12,  // CR-06 网名标签离所在线顶点中位上限
	LABEL_PERP_LO: 5,           // CR-10 标号/阻值垂直脚轴偏移下限
	LABEL_PERP_HI: 20,          // CR-10 上限
};

export const RUBRIC = [
	{ id: 'CR-01', dimension: '电气', desc: 'DRC 无 error', evidence: 'drc', severity: 'block' },
	{ id: 'CR-02', dimension: '走线', desc: '可见导线全正交;原始线段正交率达标,余为符号/引线噪声', evidence: 'geom+image-region', severity: 'block' },
	{ id: 'CR-03', dimension: '栅格', desc: '引脚坐标吸附到统一栅格', evidence: 'geom', severity: 'block' },
	{ id: 'CR-04', dimension: '朝向', desc: '器件仅用四正交旋转,镜像极少', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-05', dimension: '紧凑', desc: '相邻器件间距集中,不挤不散', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-06', dimension: '标签', desc: '网名标签贴所在线、对齐、不压器件', evidence: 'geom+image-region', severity: 'block' },
	{ id: 'CR-07', dimension: '连接', desc: '命名网络+标签为主连接,属常态不扣分;块内近距优先短直连', evidence: 'geom', severity: 'flag' },
	{ id: 'CR-08', dimension: '图框', desc: '存在标准标题栏与图框', evidence: 'image-full', severity: 'flag' },
	{ id: 'CR-09', dimension: '标注', desc: '无源件带值/封装/参数标注;关键功能块有注释;可选电路有 DNP 标注', evidence: 'image-region', severity: 'flag' },
	{ id: 'CR-10', dimension: '标注摆放', desc: '标号/阻值在器件外、垂直脚轴偏移落格、同侧错开堆叠、不压件脚线不互盖', evidence: 'geom+image-region', severity: 'block' },
];

export function crOrthogonality(model) {
	let seg = 0, ortho = 0, deg45 = 0;
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			seg++;
			const dx = l[i + 2] - l[i], dy = l[i + 3] - l[i + 1];
			if (dx === 0 || dy === 0) ortho++;
			else if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1) deg45++;
		}
	}
	const orthoPct = seg ? +(ortho / seg * 100).toFixed(1) : 100;
	return { id: 'CR-02', pass: orthoPct >= THRESHOLDS.ORTHO_MIN_PCT, orthoPct, seg, ortho, deg45, other: seg - ortho - deg45 };
}

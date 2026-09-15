// Whole-sheet checks. Drawing metadata is excluded by the snapshot reader;
// every circuit object and decorative object must remain in the usable area.
const area = b => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
const intersection = (a, b) => {
	const r = { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY),
		maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
	return r.maxX > r.minX && r.maxY > r.minY ? r : null;
};
const centroid = b => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
const round = n => +n.toFixed(3);
const zeroBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

// DR19 global composition. Measure the usable sheet as an actual shape (the
// inset sheet minus the title-block keepout), then distribute module content
// over a fixed grid. This catches global imbalance that nearest-neighbour and
// collision checks cannot see.
export function spatialBalanceQC(moduleRegions = [], { usable, keepout, cols = 4, rows = 3,
	looseFillMax = 0.55, maxCentroidOffsetRatio = 0.08, minModules = 2, grid = 5 } = {}) {
	const usableArea0 = area(usable);
	const cut = intersection(usable, keepout);
	const cutArea = cut ? area(cut) : 0;
	const usableArea = usableArea0 - cutArea;
	const uc0 = centroid(usable);
	const cc = cut ? centroid(cut) : null;
	const usableCentroid = usableArea > 0 ? {
		x: (uc0.x * usableArea0 - (cc?.x || 0) * cutArea) / usableArea,
		y: (uc0.y * usableArea0 - (cc?.y || 0) * cutArea) / usableArea,
	} : uc0;
	const boxes = moduleRegions.map(r => ({ name: r.name || r.module || r.id || '?', box: r.contentBox || r.actualBox || r.box }))
		.filter(r => r.box && area(r.box) > 0);
	const occupied = boxes.map(r => ({ ...r, box: intersection(r.box, usable) })).filter(r => r.box);
	const occupiedArea = occupied.reduce((sum, r) => sum + area(r.box), 0);
	const contentCentroid = occupiedArea > 0 ? {
		x: occupied.reduce((sum, r) => sum + centroid(r.box).x * area(r.box), 0) / occupiedArea,
		y: occupied.reduce((sum, r) => sum + centroid(r.box).y * area(r.box), 0) / occupiedArea,
	} : null;
	const fillRatio = usableArea > 0 ? occupiedArea / usableArea : 1;
	const loose = boxes.length >= minModules && fillRatio <= looseFillMax;
	const width = usable.maxX - usable.minX, height = usable.maxY - usable.minY;
	const offset = contentCentroid ? { x: contentCentroid.x - usableCentroid.x, y: contentCentroid.y - usableCentroid.y } : { x: 0, y: 0 };
	const maxOffset = { x: width * maxCentroidOffsetRatio, y: height * maxCentroidOffsetRatio };
	const cells = [];
	for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
		const cell = {
			minX: usable.minX + width * col / cols, maxX: usable.minX + width * (col + 1) / cols,
			minY: usable.minY + height * row / rows, maxY: usable.minY + height * (row + 1) / rows,
		};
		const availableArea = area(cell) - area(intersection(cell, keepout) || zeroBox);
		const cellOccupied = occupied.reduce((sum, r) => sum + area(intersection(cell, r.box) || zeroBox), 0);
		cells.push({ row, col, availableArea: round(availableArea), occupiedArea: round(cellOccupied),
			density: round(availableArea > 0 ? cellOccupied / availableArea : 0), weight: round(occupiedArea > 0 ? cellOccupied / occupiedArea : 0) });
	}
	const findings = [];
	if (loose && contentCentroid && (Math.abs(offset.x) > maxOffset.x || Math.abs(offset.y) > maxOffset.y)) findings.push({
		rule: 'DR19', kind: 'layout-content-centroid-off-center',
		usableCentroid: [round(usableCentroid.x), round(usableCentroid.y)],
		contentCentroid: [round(contentCentroid.x), round(contentCentroid.y)],
		offset: [round(offset.x), round(offset.y)], maxOffset: [round(maxOffset.x), round(maxOffset.y)],
		suggestedShift: [Math.round(-offset.x / grid) * grid, Math.round(-offset.y / grid) * grid],
	});
	return { findings, detail: { cols, rows, modules: boxes.length, usableArea: round(usableArea), occupiedArea: round(occupiedArea),
		fillRatio: round(fillRatio), loose, usableCentroid: [round(usableCentroid.x), round(usableCentroid.y)],
		contentCentroid: contentCentroid ? [round(contentCentroid.x), round(contentCentroid.y)] : null,
		offset: [round(offset.x), round(offset.y)], maxOffset: [round(maxOffset.x), round(maxOffset.y)], cells } };
}

export function pageQC(model, { sheetBounds, titleBlock, clearance = 10, moduleRegions = [], balance = {} } = {}) {
	const findings = [];
	const valid = b => b && [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)
		&& b.maxX > b.minX && b.maxY > b.minY;
	if (!valid(sheetBounds)) findings.push({ rule: 'DR19', kind: 'missing-sheet-bounds' });
	if (!valid(titleBlock)) findings.push({ rule: 'DR19', kind: 'missing-title-block-bounds' });
	if (findings.length) return { pass: false, findings };
	// A hand-entered keepout is evidence only when it agrees with the live sheet.
	// Every measured visible metadata box must fall inside it. This catches a
	// swapped or inverted axis before circuitry can receive a false page pass.
	const sheet=model?.sheetEvidence;
	if(sheet?.bbox){
		const b=sheet.bbox,tol=1;
		if(Math.abs(b.minX-sheetBounds.minX)>tol||Math.abs(b.minY-sheetBounds.minY)>tol||
			Math.abs(b.maxX-sheetBounds.maxX)>tol||Math.abs(b.maxY-sheetBounds.maxY)>tol)
			findings.push({rule:'DR19',kind:'sheet-bounds-mismatch',measured:b,declared:sheetBounds});
	}
	for(const a of sheet?.attrs||[]){
		const b=a.bbox;
		if(!(a.valueVisible||a.keyVisible)||!valid(b))continue;
		if(b.minX<titleBlock.minX||b.maxX>titleBlock.maxX||b.minY<titleBlock.minY||b.maxY>titleBlock.maxY)
			findings.push({rule:'DR19',kind:'title-block-evidence-outside-keepout',id:a.key||'sheet-attr',bbox:b});
	}
	const usable = { minX: sheetBounds.minX + clearance, minY: sheetBounds.minY + clearance,
		maxX: sheetBounds.maxX - clearance, maxY: sheetBounds.maxY - clearance };
	const keepout = { minX: titleBlock.minX - clearance, minY: titleBlock.minY - clearance,
		maxX: titleBlock.maxX + clearance, maxY: titleBlock.maxY + clearance };
	const check = (id, b) => {
		if (!b) { findings.push({ rule: 'DR19', kind: 'missing-object-bounds', id }); return; }
		if (b.minX < usable.minX || b.maxX > usable.maxX || b.minY < usable.minY || b.maxY > usable.maxY)
			findings.push({ rule: 'DR19', kind: 'outside-sheet', id });
		if (b.maxX >= keepout.minX && b.minX <= keepout.maxX && b.maxY >= keepout.minY && b.minY <= keepout.maxY)
			findings.push({ rule: 'DR19', kind: 'title-block-intrusion', id });
	};
	for (const c of model.components || []) {
		check(c.designator || c.id, c.bbox);
		for (const a of c.attrs || []) if (a.valueVisible || a.keyVisible) check(`${c.designator}.${a.key}`, a.bbox);
		for (const p of c.pins || []) { const r = p.noConnected ? 4 : 0;
			check(`${c.designator}.${p.num}`, { minX: p.x-r, maxX: p.x+r, minY: p.y-r, maxY: p.y+r }); }
	}
	for (const f of model.netflags || []) { check(f.id || f.net, f.bbox); if (f.nameBox) check(`${f.net}.name`, f.nameBox); }
	for (const w of model.wires || []) for (let i=0; i+3<w.line.length; i+=2) {
		const [x1,y1,x2,y2] = w.line.slice(i,i+4);
		check(w.id || w.net, { minX: Math.min(x1,x2), maxX: Math.max(x1,x2), minY: Math.min(y1,y2), maxY: Math.max(y1,y2) });
	}
	for (const o of [...(model.texts || []), ...(model.rectangles || [])]) check(o.id || o.text || 'decoration', o.bbox);
	const composition = spatialBalanceQC(moduleRegions, { usable, keepout, ...balance });
	findings.push(...composition.findings);
	return { pass: findings.length === 0, findings, detail: { balance: composition.detail } };
}

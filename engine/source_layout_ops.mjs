// Deterministic source-level layout operations. Callers name functional roots
// and supply only cell translations; the operation moves every positioned
// descendant as one rigid body and leaves connectivity and orientation intact.

const finite = value => typeof value === 'number' && Number.isFinite(value);

function descendantsByRoot(records) {
  const byId = new Map(records.filter(r => r.head.id).map(r => [r.head.id, r]));
  const cache = new Map();
  const rootOf = (record, seen = new Set()) => {
    if (cache.has(record.head.id)) return cache.get(record.head.id);
    if (seen.has(record.head.id)) throw new Error(`Cyclic source ownership at ${record.head.id}`);
    seen.add(record.head.id);
    const parentId = record.atom.parentId || record.atom.lineGroup;
    const parent = parentId && byId.get(parentId);
    const root = parent ? rootOf(parent, seen) : record.head.id;
    if (record.head.id) cache.set(record.head.id, root);
    return root;
  };
  const grouped = new Map();
  for (const record of records) {
    const root = rootOf(record);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(record);
  }
  return { byId, grouped };
}

function translatedAtom(atom, dx, visualDy) {
  const out = { ...atom };
  const sourceDy = -visualDy;
  if (finite(out.x)) out.x += dx;
  if (finite(out.y)) out.y += sourceDy;
  if (finite(out.startX)) out.startX += dx;
  if (finite(out.endX)) out.endX += dx;
  if (finite(out.startY)) out.startY += sourceDy;
  if (finite(out.endY)) out.endY += sourceDy;
  return out;
}

export function translateSourceCells(records, cells, { grid = 5 } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error('Source records are required');
  if (!Array.isArray(cells) || !cells.length) throw new Error('At least one source cell is required');
  const { byId, grouped } = descendantsByRoot(records);
  const claimed = new Map(), edit = new Map(), roots = [];
  for (const cell of cells) {
    if (!cell?.id || !Array.isArray(cell.roots) || !cell.roots.length) throw new Error('Each source cell needs an id and roots');
    if (!finite(cell.dx) || !finite(cell.dy)) throw new Error(`Source cell ${cell.id} needs a finite translation`);
    if (grid > 0 && (Math.abs(cell.dx / grid - Math.round(cell.dx / grid)) > 1e-9 || Math.abs(cell.dy / grid - Math.round(cell.dy / grid)) > 1e-9))
      throw new Error(`Source cell ${cell.id} translation is off the ${grid}-unit grid`);
    for (const root of cell.roots) {
      if (!byId.has(root)) throw new Error(`Unknown source root ${root} in cell ${cell.id}`);
      if (claimed.has(root)) throw new Error(`Source root ${root} belongs to both ${claimed.get(root)} and ${cell.id}`);
      claimed.set(root, cell.id); roots.push(root);
      for (const record of grouped.get(root) || []) if (record.head.id) {
        const atom = translatedAtom(record.atom, cell.dx, cell.dy);
        if (JSON.stringify(atom) !== JSON.stringify(record.atom)) edit.set(record.head.id, atom);
      }
    }
  }
  return { edit, roots, cells: cells.map(c => ({ id:c.id, roots:[...c.roots], dx:c.dx, dy:c.dy })) };
}

function recordsAt(records, edit) {
  return records.map(r => ({ ...r, atom: edit.has(r.head.id) ? edit.get(r.head.id) : r.atom }));
}

// Place already-existing visible source attributes at absolute visual-canvas
// coordinates. This is an annotation operation; it cannot change values or
// manufacture a missing attribute.
export function placeSourceAttributes(records, edit, placements) {
  if (!(edit instanceof Map)) throw new Error('Source attribute placement needs an edit map');
  const attrs = new Map();
  for (const r of recordsAt(records, edit)) if (r.head.type === 'ATTR' && r.atom.parentId) {
    const key = `${r.atom.parentId}\0${r.atom.key}`;
    if (attrs.has(key)) throw new Error(`Duplicate source attribute ${r.atom.parentId}.${r.atom.key}`);
    attrs.set(key, r);
  }
  for (const p of placements || []) {
    if (!p?.rootId || !p.key || !finite(p.x) || !finite(p.y)) throw new Error('Invalid source attribute placement');
    const r = attrs.get(`${p.rootId}\0${p.key}`);
    if (!r) throw new Error(`Source attribute is missing: ${p.rootId}.${p.key}`);
    if (r.atom.valueVisible !== true && r.atom.keyVisible !== true) throw new Error(`Source attribute is not visible: ${p.rootId}.${p.key}`);
    edit.set(r.head.id, { ...r.atom, x:p.x, y:-p.y,
      ...(p.align ? {align:p.align} : {}), ...(finite(p.rotation) ? {rotation:p.rotation} : {}) });
  }
  return edit;
}

function outsideSides(box, body) {
  const out = [];
  if (box.maxX <= body.minX) out.push('left');
  if (box.minX >= body.maxX) out.push('right');
  if (box.maxY <= body.minY) out.push('above');
  if (box.minY >= body.maxY) out.push('below');
  return out;
}

// Resolve T-ANNOT-SIDE findings without making the caller invent coordinates.
// The already placed human-readable value/model is the visual anchor; only the
// designator moves to the adjacent outward row on the same side. Real rendered
// bboxes provide the text dimensions, and every result lands on the source grid.
export function coLocateSourcePartAnnotations(records, edit, geometry, designators, { grid = 5, rowGap = 2 } = {}) {
  if (!(edit instanceof Map)) throw new Error('Source annotation colocation needs an edit map');
  if (!geometry || !Array.isArray(geometry.components)) throw new Error('Complete component geometry is required');
  if (!Array.isArray(designators) || !designators.length) throw new Error('At least one designator is required');
  if (!(finite(grid) && grid > 0) || !(finite(rowGap) && rowGap >= 0)) throw new Error('Invalid annotation grid or gap');
  const current = recordsAt(records, edit), rootByDesignator = new Map(), attrsByRoot = new Map();
  for (const r of current) if (r.head.type === 'ATTR' && r.atom.parentId) {
    if (!attrsByRoot.has(r.atom.parentId)) attrsByRoot.set(r.atom.parentId, []);
    attrsByRoot.get(r.atom.parentId).push(r);
    if (r.atom.key === 'Designator' && r.atom.value) {
      if (rootByDesignator.has(String(r.atom.value))) throw new Error(`Duplicate source designator ${r.atom.value}`);
      rootByDesignator.set(String(r.atom.value), r.atom.parentId);
    }
  }
  const geometryByDesignator = new Map();
  for (const c of geometry.components) if (c.designator) {
    if (geometryByDesignator.has(String(c.designator))) throw new Error(`Duplicate geometry designator ${c.designator}`);
    geometryByDesignator.set(String(c.designator), c);
  }
  const snapDown = value => Math.floor((value + 1e-9) / grid) * grid;
  const snapUp = value => Math.ceil((value - 1e-9) / grid) * grid;
  const snap = value => Math.round(value / grid) * grid;
  const placements = [], roots = [];
  for (const rawRef of designators) {
    const ref = String(rawRef), rootId = rootByDesignator.get(ref), component = geometryByDesignator.get(ref);
    if (!rootId || !component?.bbox) throw new Error(`Missing complete source/geometry evidence for ${ref}`);
    const sourceAttrs = attrsByRoot.get(rootId) || [], rendered = (component.attrs || []).filter(a =>
      a?.valueVisible === true && a.bbox && a.bbox.maxX > a.bbox.minX && a.bbox.maxY > a.bbox.minY);
    const sourceDesignator = sourceAttrs.find(a => a.atom.key === 'Designator');
    const geomDesignator = rendered.find(a => a.key === 'Designator');
    const geomValue = rendered.find(a => a.key === 'Name') || rendered.find(a => a.key === 'Value') ||
      rendered.find(a => a.key !== 'Designator' && String(a.value || '').trim());
    if (!sourceDesignator || !geomDesignator || !geomValue) throw new Error(`Missing visible annotation pair for ${ref}`);
    const valueSides = outsideSides(geomValue.bbox, component.bbox);
    if (!valueSides.length) throw new Error(`Value/model annotation is not outside ${ref}`);
    const designatorSides = outsideSides(geomDesignator.bbox, component.bbox);
    if (designatorSides.some(side => valueSides.includes(side))) continue;
    const side = valueSides[0], width = geomDesignator.bbox.maxX - geomDesignator.bbox.minX;
    const height = geomDesignator.bbox.maxY - geomDesignator.bbox.minY;
    const originOffsetX = finite(geomDesignator.x) ? geomDesignator.bbox.minX - geomDesignator.x : 0;
    const originOffsetY = finite(geomDesignator.y) ? geomDesignator.bbox.minY - geomDesignator.y : 0;
    let boxX, boxY;
    if (side === 'above') {
      boxX = snap(geomValue.bbox.minX);
      boxY = snapDown(geomValue.bbox.minY - rowGap - height);
    } else if (side === 'below') {
      boxX = snap(geomValue.bbox.minX);
      boxY = snapUp(geomValue.bbox.maxY + rowGap);
    } else if (side === 'left') {
      boxX = snapDown(geomValue.bbox.minX - rowGap - width);
      boxY = snap(geomValue.bbox.minY);
    } else {
      boxX = snapUp(geomValue.bbox.maxX + rowGap);
      boxY = snap(geomValue.bbox.minY);
    }
    const x = snap(boxX - originOffsetX), y = snap(boxY - originOffsetY);
    placements.push({ rootId, key:'Designator', x, y });
    roots.push(rootId);
  }
  placeSourceAttributes(records, edit, placements);
  return { edit, roots, placements };
}

// Move exactly one free endpoint of an existing wire group, preserving an
// orthogonal segment. A visible NET attribute anchored at that endpoint follows
// it, so the label remains electrically attached.
export function reanchorSourceWireEndpoint(records, edit, { rootId, from, to, align } = {}) {
  if (!(edit instanceof Map)) throw new Error('Wire reanchor needs an edit map');
  if (!rootId || !Array.isArray(from) || !Array.isArray(to) || from.length !== 2 || to.length !== 2 || ![...from,...to].every(finite))
    throw new Error('Invalid wire endpoint reanchor');
  const current = recordsAt(records, edit), matches=[];
  for (const r of current) if (r.head.type === 'LINE' && r.atom.lineGroup === rootId) {
    for (const side of ['start','end']) if (r.atom[`${side}X`] === from[0] && -r.atom[`${side}Y`] === from[1]) matches.push({r,side});
  }
  if (matches.length !== 1) throw new Error(`Wire endpoint ${rootId}@${from.join(',')} has ${matches.length} matches`);
  const {r,side}=matches[0], atom={...r.atom,[`${side}X`]:to[0],[`${side}Y`]:-to[1]};
  if (atom.startX !== atom.endX && atom.startY !== atom.endY) throw new Error('Wire reanchor would create a diagonal');
  if (atom.startX === atom.endX && atom.startY === atom.endY) throw new Error('Wire reanchor would create a zero-length segment');
  edit.set(r.head.id,atom);
  for (const a of current) if (a.head.type === 'ATTR' && a.atom.parentId === rootId && a.atom.key === 'NET' &&
    a.atom.valueVisible === true && a.atom.x === from[0] && -a.atom.y === from[1])
    edit.set(a.head.id,{...a.atom,x:to[0],y:-to[1],...(align?{align}:{})});
  return edit;
}

// Move a visible NET attribute from an existing wire endpoint to the free end
// of an added orthogonal branch. The first branch point must lie on the current
// wire graph and the branch must be a continuous chain ending at `to`.
export function branchSourceWireLabel(records, edit, { rootId, from, to, segments, align, idPrefix='fb' } = {}) {
  if (!(edit instanceof Map) || !rootId || !Array.isArray(from) || !Array.isArray(to) ||
      !Array.isArray(segments) || !segments.length || [...from,...to].every(finite)===false || !/^[0-9a-f]{2}$/i.test(idPrefix))
    throw new Error('Invalid wire-label branch');
  const current=recordsAt(records,edit), sourceLines=current.filter(r=>r.head.type==='LINE'&&r.atom.lineGroup===rootId);
  const attrs=current.filter(r=>r.head.type==='ATTR'&&r.atom.parentId===rootId&&r.atom.key==='NET'&&r.atom.valueVisible===true&&r.atom.x===from[0]&&-r.atom.y===from[1]);
  if(attrs.length!==1||!sourceLines.length)throw new Error(`Wire label ${rootId}@${from.join(',')} is not unique`);
  const on=(p,l)=>l.startX===l.endX?p[0]===l.startX&&p[1]>=Math.min(-l.startY,-l.endY)&&p[1]<=Math.max(-l.startY,-l.endY):
    -l.startY===-l.endY&&p[1]===-l.startY&&p[0]>=Math.min(l.startX,l.endX)&&p[0]<=Math.max(l.startX,l.endX);
  let cursor=segments[0].slice(0,2);
  if(!sourceLines.some(l=>on(cursor,l.atom)))throw new Error('Wire-label branch does not start on the wire graph');
  for(const segment of segments){
    if(!Array.isArray(segment)||segment.length!==4||!segment.every(finite)||(segment[0]!==segment[2]&&segment[1]!==segment[3])||segment[0]!==cursor[0]||segment[1]!==cursor[1])
      throw new Error('Wire-label branch is not a continuous orthogonal chain');
    cursor=segment.slice(2,4);
  }
  if(cursor[0]!==to[0]||cursor[1]!==to[1])throw new Error('Wire-label branch does not end at the new label anchor');
  edit.set(attrs[0].head.id,{...attrs[0].atom,x:to[0],y:-to[1],...(align?{align}:{})});
  const occupied=new Set(records.map(r=>r.head.id).filter(Boolean));let seq=1,ticket=Math.max(0,...records.map(r=>Number(r.head.ticket)||0))+1;
  const nextId=()=>{let id;do{id=`${idPrefix}${(seq++).toString(16).padStart(14,'0')}`;}while(occupied.has(id));occupied.add(id);return id;};
  const donor=sourceLines[0].atom;
  return segments.map(([x1,y1,x2,y2])=>({head:{type:'LINE',ticket:ticket++,id:nextId()},atom:{...donor,startX:x1,startY:-y1,endX:x2,endY:-y2,lineGroup:rootId}}));
}

export function replaceSingleSegmentSourceWire(records, edit, { rootId, line } = {}) {
  if(!(edit instanceof Map)||!rootId||!Array.isArray(line)||line.length!==4||!line.every(finite)||(line[0]!==line[2]&&line[1]!==line[3]))
    throw new Error('Invalid single-segment wire replacement');
  const current=recordsAt(records,edit), matches=current.filter(r=>r.head.type==='LINE'&&r.atom.lineGroup===rootId);
  if(matches.length!==1)throw new Error(`Wire ${rootId} does not contain exactly one segment`);
  const [x1,y1,x2,y2]=line,r=matches[0];
  edit.set(r.head.id,{...r.atom,startX:x1,startY:-y1,endX:x2,endY:-y2});
  return edit;
}

export function findSourceLineSegment(records, { rootId, line } = {}) {
  if(!rootId||!Array.isArray(line)||line.length!==4||!line.every(finite))throw new Error('Invalid source line lookup');
  const [x1,y1,x2,y2]=line;
  const matches=records.filter(r=>r.head.type==='LINE'&&r.atom.lineGroup===rootId&&
    ((r.atom.startX===x1&&-r.atom.startY===y1&&r.atom.endX===x2&&-r.atom.endY===y2)||
     (r.atom.startX===x2&&-r.atom.startY===y2&&r.atom.endX===x1&&-r.atom.endY===y1)));
  if(matches.length!==1)throw new Error(`Source wire segment ${rootId} has ${matches.length} matches`);
  return matches[0].head.id;
}

export function mergeSourcePlans(...plans) {
  const edit = new Map(), drop = new Set(), add = [], roots = [];
  for (const plan of plans) {
    for (const id of plan?.drop || []) {
      if (edit.has(id)) throw new Error(`Source plan both edits and drops ${id}`);
      drop.add(id);
    }
    for (const [id, atom] of plan?.edit || []) {
      if (drop.has(id) || edit.has(id)) throw new Error(`Conflicting source edit ${id}`);
      edit.set(id, atom);
    }
    for (const record of plan?.add || []) add.push(record);
    for (const root of plan?.roots || []) if (!roots.includes(root)) roots.push(root);
  }
  return { edit, drop, add, roots };
}

// Ignore numeric serialization noise, never a meaningful fraction of the schematic grid.
export function pointOnOrthogonalSegment(x,y,x1,y1,x2,y2,tolerance=1e-6) {
  if (![x,y,x1,y1,x2,y2,tolerance].every(Number.isFinite) || tolerance<0) return false;
  if (Math.abs(x1-x2)<=tolerance) return Math.abs(x-x1)<=tolerance && y>=Math.min(y1,y2)-tolerance && y<=Math.max(y1,y2)+tolerance;
  if (Math.abs(y1-y2)<=tolerance) return Math.abs(y-y1)<=tolerance && x>=Math.min(x1,x2)-tolerance && x<=Math.max(x1,x2)+tolerance;
  return false;
}

import { EXERCISES } from './exercises.js';

/** Only trust visible, in-frame joints; this does not measure model accuracy. */
export function usablePose(points, exercise) {
  if (!Array.isArray(points) || points.length < 33) return false;
  const visible = i => {
    const p=points[i];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0)>=0.6 && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1;
  };
  const ex=EXERCISES[exercise];
  const triples=ex.hold?[[11,23,25],[12,24,26]]:ex.tris;
  return triples.some(t=>t.every(visible)) && (!ex.needFoot || [27,28].some(visible));
}

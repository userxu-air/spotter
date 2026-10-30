import { CONFIG } from './config.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 以 b 为顶点的夹角（支持 2D 屏幕坐标与 3D 世界坐标） */
export function angle(a, b, c){
  if (!a || !b || !c) return NaN;
  const v1x = a.x - b.x, v1y = a.y - b.y, v1z = (a.z || 0) - (b.z || 0);
  const v2x = c.x - b.x, v2y = c.y - b.y, v2z = (c.z || 0) - (b.z || 0);
  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const m1 = Math.hypot(v1x, v1y, v1z), m2 = Math.hypot(v2x, v2y, v2z);
  if (!m1 || !m2) return NaN;
  return Math.acos(clamp(dot / (m1 * m2), -1, 1)) * 180 / Math.PI;
}

/** 关节坐标平滑：位移越大跟得越快，静止时强滤波 */
export class LandmarkSmoother {
  constructor(){ this.pts = []; }
  reset(){ this.pts.length = 0; }

  apply(lm){
    const { lmBase, lmMax, lmScale } = CONFIG.smooth;
    for (let i = 0; i < lm.length; i++){
      const p = lm[i];
      if (!p) continue;
      const prev = this.pts[i];
      if (!prev){ this.pts[i] = { x: p.x, y: p.y, z: p.z || 0, v: p.visibility ?? 1 }; continue; }
      if (prev.v < 0.3){                      // 从不可见切到可见，直接接管，避免拖影
        prev.x = p.x; prev.y = p.y; prev.z = p.z || 0;
      } else {
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        const a = Math.min(lmMax, lmBase + d * lmScale);
        prev.x += (p.x - prev.x) * a;
        prev.y += (p.y - prev.y) * a;
        prev.z += ((p.z || 0) - prev.z) * a;
      }
      prev.v = p.visibility ?? 1;
    }
    return this.pts;
  }
}

/** 角度平滑：按 key 独立缓存，换侧/换动作不串值 */
export class AngleSmoother {
  constructor(){ this.m = new Map(); }
  reset(){ this.m.clear(); }

  apply(key, v){
    const { angBase, angMax, angScale } = CONFIG.smooth;
    const p = this.m.get(key);
    if (p === undefined){ this.m.set(key, v); return v; }
    const d = Math.abs(v - p);
    const a = Math.min(angMax, angBase + d * angScale);
    const out = p + (v - p) * a;
    this.m.set(key, out);
    return out;
  }
}

export const pad2 = n => String(n).padStart(2, '0');
export const fmtClock = sec => pad2(Math.floor(sec / 60)) + ':' + pad2(Math.floor(sec % 60));

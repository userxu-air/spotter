import { LM_CONNECTIONS, LM_IDX, EXERCISES } from './exercises.js';

/** 取景器绘制：骨架、角度标签、对焦框。只读数据，不改状态。 */
export class Renderer {
  constructor(video, canvas, finder, focusEl){
    this.video = video;
    this.canvas = canvas;
    this.finder = finder;
    this.focusEl = focusEl;
    this.ctx = canvas.getContext('2d');
    this.mirror = true;
    this.fit = 'contain';        // contain=完整视野 / cover=铺满裁切
    this.w = 1; this.h = 1;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(finder);
  }

  resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = this.finder.clientWidth || 1;
    this.h = this.finder.clientHeight || 1;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 画面映射：与 video 的 object-fit 保持一致 */
  mapper(){
    const vw = this.video.videoWidth || 1, vh = this.video.videoHeight || 1;
    const fitFn = this.fit === 'cover' ? Math.max : Math.min;
    const s = fitFn(this.w / vw, this.h / vh);
    const dw = vw * s, dh = vh * s;
    const ox = (this.w - dw) / 2, oy = (this.h - dh) / 2;
    const mirror = this.mirror;
    return p => {
      const x = mirror ? (1 - p.x) : p.x;
      return [ox + x * dw, oy + p.y * dh];
    };
  }

  clear(){
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  /** @param pts 平滑后的关节数组（含 v 可见性） */
  draw(pts, exKey, angleValue, phase, { skeleton = true } = {}){
    this.clear();
    if (!skeleton || !pts || !pts.length) return;
    const ctx = this.ctx;
    const ex = EXERCISES[exKey];
    const P = this.mapper();

    const hot = new Set();
    if (ex.tris) ex.tris.forEach(t => t.forEach(i => hot.add(i)));

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(120,220,255,.92)';
    ctx.shadowColor = 'rgba(60,180,255,.85)';
    ctx.shadowBlur = 7;

    for (const [a,b] of LM_CONNECTIONS){
      const p1 = pts[a], p2 = pts[b];
      if (!p1 || !p2) continue;
      if ((p1.v ?? 1) < .34 || (p2.v ?? 1) < .34) continue;
      const A = P(p1), B = P(p2);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }

    // 颈：鼻 → 肩中点
    const n = pts[0], s1 = pts[11], s2 = pts[12];
    if (n && s1 && s2 && (n.v ?? 1) > .34 && (s1.v ?? 1) > .34 && (s2.v ?? 1) > .34){
      const neck = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
      const A = P(n), B = P(neck);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
    ctx.shadowBlur = 0;

    for (const i of LM_IDX){
      const p = pts[i];
      if (!p || (p.v ?? 1) < .34) continue;
      const [x, y] = P(p);
      const isHot = hot.has(i);
      ctx.beginPath();
      ctx.arc(x, y, isHot ? 5.5 : 2.8, 0, Math.PI * 2);
      ctx.lineWidth = isHot ? 2 : 1.4;
      ctx.strokeStyle = isHot ? '#ffd60a' : 'rgba(180,240,255,.85)';
      ctx.stroke();
      if (isHot){
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,214,10,.26)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }

    // 发力时显示关键角度
    if (ex.tris && !isNaN(angleValue) && phase === 'bottom'){
      const t = ex.tris[0];
      const p = pts[t[1]];
      if (p){
        const [x, y] = P(p);
        const label = Math.round(angleValue) + '°';
        ctx.font = '600 14px -apple-system,system-ui,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0,0,0,.62)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - tw/2 - 7, y - 40, tw + 14, 21, 7);
        else ctx.rect(x - tw/2 - 7, y - 40, tw + 14, 21);
        ctx.fill();
        ctx.fillStyle = '#ffd60a';
        ctx.fillText(label, x, y - 29);
      }
    }
  }

  /** 对焦框跟随人体，并夹进取景安全区 */
  focus(pts, locked){
    const el = this.focusEl;
    if (!pts || !pts.length){ el.classList.remove('on', 'lock'); return; }
    let minX = 1, minY = 1, maxX = 0, maxY = 0, n = 0;
    for (const i of LM_IDX){
      const p = pts[i];
      if (!p || (p.v ?? 1) < 0.4) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      n++;
    }
    if (n < 8){ el.classList.remove('on', 'lock'); return; }

    const P = this.mapper();
    const A = P({x:minX, y:minY}), B = P({x:maxX, y:maxY});
    const pad = 16;
    const SAFE_TOP = 96, SAFE_BOTTOM = this.h - 176;
    let x1 = Math.min(A[0],B[0]) - pad, x2 = Math.max(A[0],B[0]) + pad;
    let y1 = Math.min(A[1],B[1]) - pad, y2 = Math.max(A[1],B[1]) + pad;
    y1 = Math.min(Math.max(y1, SAFE_TOP), Math.max(SAFE_TOP, SAFE_BOTTOM - 70));
    y2 = Math.max(Math.min(y2, SAFE_BOTTOM), y1 + 70);
    x1 = Math.max(x1, 8); x2 = Math.min(x2, this.w - 8);
    if (x2 - x1 < 70) x2 = x1 + 70;

    el.style.left = x1 + 'px';
    el.style.top = y1 + 'px';
    el.style.width = (x2 - x1) + 'px';
    el.style.height = (y2 - y1) + 'px';
    el.classList.add('on');
    el.classList.toggle('lock', !!locked);
  }

  hideFocus(){ this.focusEl.classList.remove('on', 'lock'); }
}

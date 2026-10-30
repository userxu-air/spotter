import { EXERCISES } from './exercises.js';
import { angle, AngleSmoother } from './math.js';

/**
 * 计数状态机：纯逻辑，不碰 DOM。
 * update() 返回事件列表与当前读数，由上层决定如何反馈。
 *
 * 事件：
 *  { type:'rep' }                       完成一次动作
 *  { type:'holdDone', seconds }         静态保持类完成一段
 *  { type:'warn', msg }                 姿态问题（膝内扣/塌腰/幅度不足…）
 *  { type:'guide', msg }                站位问题（太远/太近/脚未入镜）
 */
export class RepCounter {
  constructor(key = 'squat'){
    this.smoother = new AngleSmoother();
    this.setExercise(key);
  }

  setExercise(key){
    if (!EXERCISES[key]) return;
    this.key = key;
    this.ex = EXERCISES[key];
    this.smoother.reset();
    this.reset();
  }

  reset(){
    this.phase = 'init';       // init | top | bottom
    this.count = 0;
    this.minAng = 999;
    this.cur = NaN;
    this.holdStart = 0;
    this.holdBest = 0;
    this.lastSide = 0;
  }

  /** 当前保持秒数（静态动作） */
  holdSeconds(now){
    return this.holdStart ? (now - this.holdStart) / 1000 : 0;
  }

  update(lmN, lmW, now){
    const ex = this.ex;
    const out = {
      events: [], angle: this.cur, phase: this.phase,
      count: this.count, blocked: false, holding: false, holdSeconds: 0
    };
    if (!lmN) return out;

    const push = (type, extra) => out.events.push(Object.assign({ type }, extra));

    /* ---------- 站位自检 ---------- */
    if (ex.tris && !ex.hold){
      const shY = ((lmN[11]?.y ?? 0) + (lmN[12]?.y ?? 0)) / 2;
      if (ex.needFoot){
        const vFoot = Math.max(lmN[27]?.visibility ?? 1, lmN[28]?.visibility ?? 1);
        if (vFoot < 0.5){ out.blocked = true; push('guide', { msg: '退后一点，让脚也进画面' }); return out; }
        const anY = ((lmN[27]?.y ?? 0) + (lmN[28]?.y ?? 0)) / 2;
        const bodyH = Math.abs(anY - shY);
        if (bodyH > 0 && bodyH < 0.30){ out.blocked = true; push('guide', { msg: '离得太远，走近一些' }); return out; }
        if (bodyH > 0.94){ out.blocked = true; push('guide', { msg: '太近了，退后两步' }); return out; }
      } else {
        // 半身动作按躯干占比判断，不要求脚入镜
        const hipY = ((lmN[23]?.y ?? 0) + (lmN[24]?.y ?? 0)) / 2;
        const torso = Math.abs(hipY - shY);
        if (torso > 0 && torso < 0.07){ out.blocked = true; push('guide', { msg: '走近一些，看不太清' }); return out; }
        if (torso > 0.62){ out.blocked = true; push('guide', { msg: '退后一点，手臂出画面了' }); return out; }
      }
    }

    /* ---------- 静态保持类 ---------- */
    if (ex.hold){
      const body = angle(lmN[11], lmN[23], lmN[25]);
      const valid = body > 155 && body < 205;
      this.cur = body;
      out.angle = body;

      if (valid){
        if (!this.holdStart) this.holdStart = now;
        const t = (now - this.holdStart) / 1000;
        if (t > this.holdBest) this.holdBest = t;
        this.phase = 'bottom';
        out.holding = true;
        out.holdSeconds = t;
      } else {
        if (this.holdStart && this.holdBest > 0 && (now - this.holdStart) > 3000){
          const done = this.holdBest;
          this.count++;
          this.holdBest = 0; this.holdStart = 0;
          push('holdDone', { seconds: done });
        } else if (this.holdStart){
          this.holdStart = 0;
          push('warn', { msg: '姿势不达标，重新计时' });
        }
        this.phase = 'init';
      }
      const msg = ex.judge?.(lmN);
      if (msg) push('warn', { msg });
      out.phase = this.phase;
      out.count = this.count;
      return out;
    }

    /* ---------- 计数类：角度优先取 3D 世界坐标 ---------- */
    const src = (Array.isArray(lmW) && lmW.length >= 33) ? lmW : lmN;
    let best = NaN, bestVis = -1, side = 0;
    for (let s = 0; s < ex.tris.length; s++){
      const [a,b,c] = ex.tris[s];
      const vis = Math.min(lmN[a]?.visibility ?? 1, lmN[b]?.visibility ?? 1, lmN[c]?.visibility ?? 1);
      let ang = angle(src[a], src[b], src[c]);
      if (isNaN(ang) && src !== lmN) ang = angle(lmN[a], lmN[b], lmN[c]);
      if (!isNaN(ang) && vis > bestVis){ bestVis = vis; best = ang; side = s; }
    }
    if (isNaN(best)) return out;

    this.lastSide = side;
    best = this.smoother.apply(this.key + ':' + side, best);
    this.cur = best;
    out.angle = best;
    if (best < this.minAng) this.minAng = best;

    const D = ex.downAt, U = ex.upAt;

    if (ex.invert){
      if (this.phase === 'init') this.phase = best < D ? 'top' : 'bottom';
      if (this.phase === 'top' && best > U) this.phase = 'bottom';
      else if (this.phase === 'bottom' && best < D){ this.phase = 'top'; this.commit(push); }
    } else {
      if (this.phase === 'init') this.phase = best > U ? 'top' : 'bottom';
      if (this.phase === 'top' && best < D) this.phase = 'bottom';
      else if (this.phase === 'bottom' && best > U){
        this.phase = 'top';
        // 幅度不足不计入，但给出提示
        if (this.minAng > (ex.minDeep ?? 110)){
          push('warn', { msg: ex.shallowMsg || '幅度不够' });
          this.minAng = 999;
          out.phase = this.phase;
          out.angle = this.cur;
          return out;
        }
        this.commit(push);
      }
    }

    const msg = ex.judge?.(lmN, best, this.minAng);
    if (msg) push('warn', { msg });

    out.phase = this.phase;
    out.count = this.count;
    return out;
  }

  commit(push){
    this.count++;
    this.minAng = 999;
    push('rep');
  }
}

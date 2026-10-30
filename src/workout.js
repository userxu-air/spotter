import { CONFIG } from './config.js';

/**
 * 训练流程：自由模式 / 目标模式（组数 × 每组量）
 * 统一用 value 表示进度（次数类=次，保持类=秒）。
 * 只负责状态推进，不碰 DOM。
 */
export class Workout {
  constructor(){ this.reset(); }

  reset(){
    this.mode = 'free';
    this.ex = 'squat';
    this.targetSets = 0;
    this.targetPerSet = 0;
    this.setIndex = 1;
    this.setValue = 0;
    this.totalValue = 0;
    this.sets = [];
    this.state = 'idle';         // idle | training | resting | done
    this.startedAt = 0;
    this.trainingMs = 0;
    this.restEndsAt = 0;
    this.lastTickAt = 0;
  }

  configure({ mode = 'free', ex = 'squat', sets = 3, perSet = 15 } = {}){
    this.mode = mode;
    this.ex = ex;
    this.targetSets = mode === 'target' ? Math.max(1, sets | 0) : 0;
    this.targetPerSet = mode === 'target' ? Math.max(1, perSet | 0) : 0;
  }

  get isTarget(){ return this.mode === 'target' && this.targetSets > 0; }
  get unit(){ return this.ex === 'plank' ? '秒' : '次'; }

  start(now){
    this.state = 'training';
    this.startedAt = now;
    this.lastTickAt = now;
    this.setIndex = 1;
    this.setValue = 0;
    this.totalValue = 0;
    this.sets = [];
    this.trainingMs = 0;
    this.restEndsAt = 0;
  }

  /** 每帧推进时钟。休息结束返回 'restEnd' */
  tick(now){
    if (this.state === 'training'){
      this.trainingMs += Math.max(0, now - this.lastTickAt);
    }
    this.lastTickAt = now;
    if (this.state === 'resting' && now >= this.restEndsAt){
      this.state = 'training';
      this.restEndsAt = 0;
      return 'restEnd';
    }
    return null;
  }

  restLeft(now){
    return this.state === 'resting' ? Math.max(0, (this.restEndsAt - now) / 1000) : 0;
  }

  /** 记录一次进度。返回 'rest' | 'done' | null */
  addValue(v, now){
    if (this.state !== 'training' || v <= 0) return null;
    this.setValue += v;
    this.totalValue += v;

    if (this.isTarget && this.setValue >= this.targetPerSet){
      this.sets.push({ index: this.setIndex, value: this.setValue });
      if (this.setIndex >= this.targetSets){
        this.state = 'done';
        this.setValue = 0;
        return 'done';
      }
      this.setIndex++;
      this.setValue = 0;
      this.state = 'resting';
      this.restEndsAt = now + CONFIG.restSeconds * 1000;
      return 'rest';
    }
    return null;
  }

  skipRest(now){
    if (this.state !== 'resting') return;
    this.state = 'training';
    this.restEndsAt = 0;
    this.lastTickAt = now;
  }

  /** 手动结束：把进行中的组也计入总结 */
  finish(now){
    if (this.state === 'training') this.trainingMs += Math.max(0, now - this.lastTickAt);
    if (this.setValue > 0){
      this.sets.push({ index: this.setIndex, value: this.setValue, partial: true });
      this.setValue = 0;
    }
    this.state = 'done';
    this.restEndsAt = 0;
    this.lastTickAt = now;
    return this.summary();
  }

  summary(){
    return {
      ex: this.ex,
      mode: this.mode,
      unit: this.unit,
      totalValue: this.totalValue,
      sets: this.sets.slice(),
      completedSets: this.sets.filter(s => !s.partial).length,
      targetSets: this.targetSets,
      targetPerSet: this.targetPerSet,
      seconds: Math.round(this.trainingMs / 1000),
      at: Date.now()
    };
  }
}

import { angle, dist } from './math.js';

/**
 * 动作定义。
 * tris: 参与判定的关节三元组（取可视性更好的一侧）
 * downAt / upAt: 状态机阈值；invert 表示"角度越大越发力"
 * needFoot: 是否要求全身入镜（决定站位自检走哪套规则）
 * hold: 静态保持类动作，按秒计时
 */
export const EXERCISES = {
  squat: {
    label: '深蹲', key: 'SQUAT', unit: '次', needFoot: true,
    hint: '侧面或正面站，手机放齐腰高度',
    tris: [[23,25,27],[24,26,28]],
    downAt: 105, upAt: 158, minDeep: 118,
    shallowMsg: '蹲太浅，再深一点',
    judge: (lm) => {
      const hipW = dist(lm[23], lm[24]);
      const kneeW = dist(lm[25], lm[26]);
      const ankleW = dist(lm[27], lm[28]);
      if (hipW > 0.06 && kneeW / hipW < 0.68 && kneeW < ankleW * 0.85) return '膝盖内扣，向外打开';
      return null;
    }
  },
  pushup: {
    label: '俯卧撑', key: 'PUSHUP', unit: '次', needFoot: true,
    hint: '手机放地面或低处，从侧面拍',
    tris: [[11,13,15],[12,14,16]],
    downAt: 95, upAt: 155, minDeep: 105,
    shallowMsg: '幅度不够，再低一点',
    judge: (lm) => {
      const body = angle(lm[11], lm[23], lm[25]);
      if (body < 152) return '腰塌了，收紧核心';
      if (body > 205) return '屁股翘太高，放平';
      return null;
    }
  },
  curl: {
    label: '弯举', key: 'CURL', unit: '次', needFoot: false,
    hint: '侧面站，手臂完整入镜',
    tris: [[11,13,15],[12,14,16]],
    downAt: 62, upAt: 150, minDeep: 85,
    shallowMsg: '幅度不够，再弯一点',
    judge: (lm, ang, minAng) => (minAng > 80 ? '幅度不够，再弯一点' : null)
  },
  raise: {
    label: '侧平举', key: 'RAISE', unit: '次', needFoot: false,
    hint: '正面站，双臂完整入镜',
    tris: [[23,11,13],[24,12,14]],
    downAt: 30, upAt: 78, invert: true,
    judge: (lm) => {
      const l = Math.abs(lm[11].y - lm[15].y), r = Math.abs(lm[12].y - lm[16].y);
      return Math.abs(l - r) > 0.12 ? '两边不平衡，慢一点' : null;
    }
  },
  plank: {
    label: '平板支撑', key: 'PLANK', unit: '秒', needFoot: true, hold: true,
    hint: '侧面拍，全身入镜',
    judge: (lm) => {
      const body = angle(lm[11], lm[23], lm[25]);
      if (body < 152) return '腰塌了，收紧核心';
      if (body > 205) return '屁股翘太高，放平';
      return null;
    }
  }
};

export const EXERCISE_KEYS = Object.keys(EXERCISES);

/* 骨架连接关系（颈部由肩中点虚拟连接，避免鼻-肩直连的"披风"感） */
export const LM_CONNECTIONS = [
  [11,12],[11,23],[12,24],[23,24],
  [11,13],[13,15],[12,14],[14,16],
  [23,25],[25,27],[24,26],[26,28],
  [27,31],[28,32],[15,17],[16,18],
  [15,19],[16,20],[15,21],[16,22]
];
export const LM_IDX = [0,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,31,32];

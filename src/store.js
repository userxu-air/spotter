import { CONFIG } from './config.js';

const dayKey = () => new Date().toISOString().slice(0, 10);

function readAll(){
  try { return JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}'); }
  catch { return {}; }
}
function writeAll(data){
  try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(data)); return true; }
  catch { return false; }     // 隐私模式 / 配额满：训练不受影响，仅不落盘
}

/** 保存一次训练总结 */
export function saveSession(summary){
  const all = readAll();
  const k = dayKey();
  if (!Array.isArray(all[k])) all[k] = [];
  all[k].push(summary);
  // 只保留最近 30 天，避免无限增长
  const days = Object.keys(all).sort();
  while (days.length > 30) delete all[days.shift()];
  return writeAll(all);
}

export function getSessions(day = dayKey()){
  const all = readAll();
  return Array.isArray(all[day]) ? all[day] : [];
}

export function getTodayStats(){
  const list = getSessions();
  return {
    sessions: list.length,
    reps: list.reduce((s, r) => s + (r.unit === '次' ? r.totalValue : 0), 0),
    holdSeconds: list.reduce((s, r) => s + (r.unit === '秒' ? r.totalValue : 0), 0),
    seconds: list.reduce((s, r) => s + (r.seconds || 0), 0)
  };
}

export function clearToday(){
  const all = readAll();
  delete all[dayKey()];
  return writeAll(all);
}

export const prefs = {
  get(key, fallback){
    try {
      const v = localStorage.getItem(CONFIG.storageKey + '.pref.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value){
    try { localStorage.setItem(CONFIG.storageKey + '.pref.' + key, JSON.stringify(value)); } catch {}
  }
};

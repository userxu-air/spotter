import { CONFIG } from './config.js';
import { EXERCISES, EXERCISE_KEYS } from './exercises.js';
import { LandmarkSmoother, fmtClock, angle } from './math.js';
import { PoseEngine } from './pose-engine.js';
import { RepCounter } from './counter.js';
import { Workout } from './workout.js';
import { Renderer } from './renderer.js';
import { voice } from './voice.js';
import { saveSession, getSessions, getTodayStats, clearToday, prefs } from './store.js';

const $ = id => document.getElementById(id);
const video = $('video'), finder = $('finder'), videoBg = $('videoBg');

/* ============================================================
   状态
   ============================================================ */
const state = {
  phase: 'boot',            // boot | ready | live | training | resting | summary | error
  ex: prefs.get('ex', 'squat'),
  mode: prefs.get('mode', 'free'),
  sets: prefs.get('sets', 3),
  perSet: prefs.get('perSet', 15),
  skeleton: prefs.get('skeleton', true),
  grid: prefs.get('grid', true),
  lastSummary: null
};

const engine = new PoseEngine();
const counter = new RepCounter(state.ex);
const workout = new Workout();
const smoother = new LandmarkSmoother();
const renderer = new Renderer(video, $('overlay'), finder, $('focus'));

let lastVideoTime = -1;
let noPoseSince = 0;
let frameTimes = [];
let lowFpsSince = 0;
let lastSummarySavedAt = 0;

/* 简单节流器（按 key 独立计时） */
const _throttleMap = new Map();
function throttle(key, ms, fn){
  const now = performance.now();
  if (now - (_throttleMap.get(key) || 0) < ms) return;
  _throttleMap.set(key, now);
  fn();
}

/* ============================================================
   基础 UI
   ============================================================ */
let toastTimer = 0;
function toast(msg, kind){
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast on' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast' + (kind ? ' ' + kind : ''); }, 2000);
}

function setChip(text, kind){
  const el = $('chipPhase');
  el.textContent = text;
  el.className = 'chip' + (kind ? ' ' + kind : '');
}

function guide(msg){
  setChip('调整站位', 'bad');
  throttle('guide', 4200, () => { toast(msg, 'err'); voice.say(msg, { gap: 5000 }); });
}
function warn(msg){
  throttle('warn', 2000, () => { toast(msg, 'err'); voice.say(msg, { gap: 2600 }); });
}

function showGate(show){ $('gate').classList.toggle('hide', !show); }
function setGate({ title, desc, stat, error, showRetry } = {}){
  if (title !== undefined) $('gateTitle').innerHTML = title;
  if (desc !== undefined) $('gateDesc').innerHTML = desc;
  if (stat !== undefined){
    $('loadStat').textContent = stat;
    $('loadStat').classList.toggle('err', !!error);
  }
  if (showRetry !== undefined) $('retryBtn').classList.toggle('hidden', !showRetry);
}

/* ============================================================
   动作与设置
   ============================================================ */
EXERCISE_KEYS.forEach(k => {
  const b = document.createElement('button');
  b.className = 'mode' + (k === state.ex ? ' on' : '');
  b.textContent = EXERCISES[k].label;
  b.dataset.key = k;
  b.onclick = () => selectExercise(k);
  $('modes').appendChild(b);
});

function selectExercise(key){
  if (key === state.ex || !EXERCISES[key]) return;
  if (state.phase === 'training' || state.phase === 'resting'){
    toast('先结束当前训练再换动作');
    return;
  }
  state.ex = key;
  prefs.set('ex', key);
  counter.setExercise(key);
  smoother.reset();
  [...$('modes').children].forEach(c => c.classList.toggle('on', c.dataset.key === key));
  $('perSetLabel').textContent = EXERCISES[key].hold ? '每组秒数' : '每组次数';
  $('hudLabel').textContent = EXERCISES[key].hold ? 'HOLD' : EXERCISES[key].key;
  $('hudUnit').textContent = EXERCISES[key].unit;
  renderIdleHud();
  toast(EXERCISES[key].label + ' · ' + EXERCISES[key].hint);
}

function renderIdleHud(){
  $('hudValue').textContent = '0';
  $('hudUnit').textContent = EXERCISES[state.ex].unit;
  $('setLine').textContent = state.mode === 'target'
    ? `目标 ${state.sets} 组 × ${state.perSet}${EXERCISES[state.ex].unit}`
    : '自由练 · 点快门开始';
  $('chipAngle').innerHTML = '角度 <b>—</b>';
  setChip('待开始');
}

function applyToggles(){
  voice.enabled = !!state.voiceOn;
  $('soundBtn').classList.toggle('off', !voice.enabled);
  $('grid').classList.toggle('off', !state.grid);
  document.querySelectorAll('.sw').forEach(b => {
    const k = b.dataset.toggle;
    const on = k === 'voice' ? voice.enabled : k === 'skeleton' ? state.skeleton : state.grid;
    b.classList.toggle('on', on);
  });
}
state.voiceOn = prefs.get('voice', false);   // 默认静音，在设置里开启
state.fit = prefs.get('fit', 'contain');

/** 取景方式：完整视野（有模糊背景填充，画面不裁切）/ 铺满裁切 */
function applyFit(){
  video.style.objectFit = state.fit === 'cover' ? 'cover' : 'contain';
  renderer.fit = state.fit;
  // 完整视野时用同一路视频做模糊背景，填掉上下留白
  videoBg.classList.toggle('on', state.fit === 'contain' && !!engine.stream);
  videoBg.classList.toggle('mirror', renderer.mirror);
  const seg = $('fitSeg');
  if (seg) seg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', b.dataset.fit === state.fit));
}

/** 背景层共享同一路视频流 */
function syncBg(){
  if (!engine.stream){ videoBg.srcObject = null; return; }
  if (videoBg.srcObject !== engine.stream){
    videoBg.srcObject = engine.stream;
    videoBg.play().catch(() => {});
  }
  videoBg.classList.toggle('mirror', renderer.mirror);
  videoBg.classList.toggle('on', state.fit === 'contain');
}

/* ============================================================
   启动流程
   ============================================================ */
function checkEnvironment(){
  const ua = navigator.userAgent;
  if (/MicroMessenger/i.test(ua)){
    return '请点右上角「⋯」→「在浏览器打开」。<br>微信内置浏览器无法正常调用摄像头。';
  }
  if (!window.isSecureContext && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
    return '当前链接不是 HTTPS，浏览器会禁止摄像头。<br>请使用 https 链接打开。';
  }
  if (!navigator.mediaDevices?.getUserMedia){
    return '当前浏览器不支持摄像头调用。<br>请用 Safari 或 Chrome 打开。';
  }
  return null;
}

async function boot(){
  showGate(true);
  const envErr = checkEnvironment();
  if (envErr){
    state.phase = 'error';
    setGate({ title: '暂时无法使用', desc: envErr, stat: '换用系统浏览器后再试', error: true });
    $('startBtn').disabled = true;
    $('progressBox').classList.add('done');
    return;
  }

  $('retryBtn').classList.add('hidden');
  $('startBtn').disabled = true;
  $('progressBox').classList.remove('done');

  try {
    await engine.init(video, (p, msg) => {
      $('bar').style.width = Math.round(p * 100) + '%';
      setGate({ stat: msg + ' · ' + Math.round(p * 100) + '%' });
    });
    state.phase = 'ready';
    $('progressBox').classList.add('done');
    setGate({ stat: '模型就绪 · 全程离线运行' });
    $('startBtn').disabled = false;
    $('engineNote').textContent =
      `本地推理 · ${engine.delegate} · 画面与数据均不上传`;
    applyToggles();
    renderIdleHud();
    loop();
  } catch (e){
    console.error(e);
    state.phase = 'error';
    setGate({
      title: '模型加载失败',
      desc: '可能是网络中断或存储受限。<br>连接 WiFi 后重试，或换个浏览器。',
      stat: String(e?.message || e), error: true, showRetry: true
    });
    $('progressBox').classList.add('done');
  }
}

$('retryBtn').onclick = () => location.reload();

/* ============================================================
   摄像头开启
   ============================================================ */
async function openFinder(){
  if (!engine.ready) return;
  $('startBtn').disabled = true;
  setGate({ stat: '正在启动取景器…' });
  try {
    voice.unlock();
    const size = await engine.openCamera('user');
    renderer.mirror = engine.mirror;
    renderer.resize();
    syncBg();
    applyFit();
    $('resTag').textContent = (() => {
      const short = Math.min(size.width, size.height);
      return short >= 1080 ? '1080P' : short >= 720 ? '720P' : short + 'P';
    })();
    showGate(false);
    $('hud').classList.add('show');
    $('modes').classList.add('show');
    startWorkout();
  } catch (e){
    state.phase = 'error';
    showGate(true);
    const msg = e?.name === 'NotAllowedError'
      ? '摄像头权限被拒绝。<br>请在浏览器地址栏的权限设置里允许摄像头，然后重试。'
      : e?.name === 'NotFoundError'
        ? '没有找到可用摄像头。'
        : '无法启动摄像头：' + (e?.message || e);
    setGate({ title: '无法打开摄像头', desc: msg, stat: '允许权限后点下方按钮重试', error: true, showRetry: true });
    $('startBtn').disabled = false;
  }
}

$('startBtn').onclick = openFinder;

/* ============================================================
   训练流程
   ============================================================ */
function startWorkout(){
  workout.configure({ mode: state.mode, ex: state.ex, sets: state.sets, perSet: state.perSet });
  workout.start(performance.now());
  counter.reset();
  smoother.reset();
  state.phase = 'training';
  noPoseSince = 0;
  $('rec').classList.add('on');
  $('shutter').classList.add('on');
  $('summarySheet').classList.remove('show');
  $('restSheet').classList.remove('show');
  $('hudLabel').textContent = EXERCISES[state.ex].hold ? 'HOLD' : EXERCISES[state.ex].key;
  // 开始即刷新，避免沿用上一次训练的读数
  $('hudValue').textContent = '0';
  $('hudUnit').textContent = EXERCISES[state.ex].unit;
  $('setLine').textContent = workout.isTarget
    ? `第 1/${workout.targetSets} 组 · 本组 0/${workout.targetPerSet}`
    : '自由练';
  setChip('回位');
  voice.say('开始', { force: true });
  toast(EXERCISES[state.ex].label + ' · 开始');
}

function enterRest(){
  state.phase = 'resting';
  counter.reset();
  smoother.reset();
  $('restSheet').classList.add('show');
  $('restDone').textContent = workout.setIndex - 1;
  $('restNext').textContent = `${workout.setIndex}/${workout.targetSets}`;
  voice.say(`第${workout.setIndex - 1}组完成，休息${CONFIG.restSeconds}秒`, { force: true });
  setChip('休息中');
}

function leaveRest(){
  $('restSheet').classList.remove('show');
  state.phase = 'training';
  counter.reset();
  smoother.reset();
  voice.say(`开始第${workout.setIndex}组`, { force: true });
  setChip('回位');
}

function finishWorkout(auto){
  if (state.phase === 'summary') return;
  const summary = workout.finish(performance.now());
  state.phase = 'summary';
  state.lastSummary = summary;
  $('restSheet').classList.remove('show');
  $('shutter').classList.remove('on');
  $('rec').classList.remove('on');
  voice.stop();
  if (summary.totalValue > 0){
    saveSession(summary);
    renderToday();
  }
  renderSummary(summary, auto);
  $('summarySheet').classList.add('show');
  if (summary.totalValue > 0) voice.say('训练完成', { force: true });
}

function renderSummary(s, auto){
  const ex = EXERCISES[s.ex];
  $('sumTitle').textContent = ex.label + (auto ? ' · 目标达成' : ' · 本次训练');
  $('sumValue').textContent = s.unit === '秒' ? Math.round(s.totalValue) : s.totalValue;
  $('sumUnit').textContent = s.unit;
  $('sumMeta').textContent =
    `${s.completedSets || s.sets.length} 组 · 用时 ${fmtClock(s.seconds)}` +
    (s.mode === 'target' ? ` · 目标 ${s.targetSets}×${s.targetPerSet}${s.unit}` : ' · 自由练');
  $('sumSets').innerHTML = s.sets.length
    ? s.sets.map(g => `<div class="setRow"><span class="idx">第 ${g.index} 组${g.partial ? '（未完）' : ''}</span><span class="val">${Math.round(g.value * 10) / 10}<em>${s.unit}</em></span></div>`).join('')
    : '<div class="hempty">这次没有完成有效动作</div>';
}

$('skipRest').onclick = () => { workout.skipRest(performance.now()); leaveRest(); };
$('sumClose').onclick = () => {
  $('summarySheet').classList.remove('show');
  state.phase = 'live';
  workout.reset();
  counter.reset();
  smoother.reset();
  renderIdleHud();
  renderer.clear();
  renderer.hideFocus();
};
$('sumAgain').onclick = () => { $('summarySheet').classList.remove('show'); startWorkout(); };

/* ============================================================
   快门与镜头
   ============================================================ */
$('shutter').onclick = () => {
  voice.unlock();
  if (state.phase === 'ready' || state.phase === 'error'){ openFinder(); return; }
  if (state.phase === 'live'){ startWorkout(); return; }
  if (state.phase === 'training' || state.phase === 'resting'){ finishWorkout(false); }
};

$('flipBtn').onclick = async () => {
  if (!engine.stream){ toast('先开启摄像头'); return; }
  try {
    await engine.flip();
    renderer.mirror = engine.mirror;
    syncBg();
    smoother.reset();
    toast(engine.facing === 'user' ? '前置镜头' : '后置镜头');
  } catch { toast('镜头切换失败', 'err'); }
};

$('soundBtn').onclick = () => {
  state.voiceOn = !state.voiceOn;
  prefs.set('voice', state.voiceOn);
  applyToggles();
  if (state.voiceOn){ voice.unlock(); voice.say('语音已开', { force: true }); }
  else voice.stop();
  toast(state.voiceOn ? '语音：开' : '语音：关');
};

/* 双击取景区切换网格 */
let lastTap = 0;
finder.addEventListener('click', e => {
  if (e.target.closest('button')) return;
  const now = Date.now();
  if (now - lastTap < 280){
    state.grid = !state.grid;
    prefs.set('grid', state.grid);
    applyToggles();
    toast(state.grid ? '网格：开' : '网格：关');
  }
  lastTap = now;
});

/* ============================================================
   设置抽屉
   ============================================================ */
function openSettings(){
  renderSettings();
  renderToday();
  $('settingsSheet').classList.add('show');
}
$('settingsBtn').onclick = openSettings;
$('gateSettings').onclick = openSettings;
$('settingsClose').onclick = () => $('settingsSheet').classList.remove('show');
$('settingsSheet').addEventListener('click', e => {
  if (e.target === $('settingsSheet')) $('settingsSheet').classList.remove('show');
});

function renderSettings(){
  $('modeSeg').querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === state.mode));
  $('targetFields').style.display = state.mode === 'target' ? '' : 'none';
  $('setsVal').textContent = state.sets;
  $('perSetVal').textContent = state.perSet;
  $('perSetLabel').textContent = EXERCISES[state.ex].hold ? '每组秒数' : '每组次数';
}

$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  state.mode = b.dataset.mode;
  prefs.set('mode', state.mode);
  renderSettings();
  if (state.phase === 'live') renderIdleHud();
});

document.querySelectorAll('[data-step]').forEach(b => {
  b.onclick = () => {
    const [field, delta] = b.dataset.step.split(':');
    const d = Number(delta);
    if (field === 'sets') state.sets = Math.min(10, Math.max(1, state.sets + d));
    else {
      const step = EXERCISES[state.ex].hold ? 5 : 1;
      state.perSet = Math.min(EXERCISES[state.ex].hold ? 300 : 200,
                              Math.max(step, state.perSet + d * step));
    }
    prefs.set('sets', state.sets);
    prefs.set('perSet', state.perSet);
    renderSettings();
    if (state.phase === 'live') renderIdleHud();
  };
});

document.querySelectorAll('.sw').forEach(b => {
  b.onclick = () => {
    const k = b.dataset.toggle;
    if (k === 'voice'){
      state.voiceOn = !state.voiceOn;
      prefs.set('voice', state.voiceOn);
      // 打开语音时借这次点击手势解锁 iOS 播报
      if (state.voiceOn){ voice.unlock(); voice.say('语音已开', { force: true }); }
      else voice.stop();
    }
    if (k === 'skeleton'){ state.skeleton = !state.skeleton; prefs.set('skeleton', state.skeleton); }
    if (k === 'grid'){ state.grid = !state.grid; prefs.set('grid', state.grid); }
    applyToggles();
  };
});

$('fitSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-fit]');
  if (!b || b.dataset.fit === state.fit) return;
  state.fit = b.dataset.fit;
  prefs.set('fit', state.fit);
  applyFit();
  toast(state.fit === 'contain' ? '完整视野（未裁切）' : '铺满画面（左右会裁切）');
});

function renderToday(){
  const stats = getTodayStats();
  $('todayBox').innerHTML = `
    <div class="tcard"><b>${stats.reps}</b><span>总次数</span></div>
    <div class="tcard"><b>${stats.sessions}</b><span>训练次数</span></div>
    <div class="tcard"><b>${Math.round(stats.seconds / 60)}</b><span>分钟</span></div>`;
  const list = getSessions().slice().reverse();
  $('historyList').innerHTML = list.length
    ? list.map(s => {
        const d = new Date(s.at);
        const t = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        return `<div class="hrow"><span>${EXERCISES[s.ex]?.label || s.ex}<span class="t"> · ${t}</span></span><span class="v">${Math.round(s.totalValue)}${s.unit}</span></div>`;
      }).join('')
    : '<div class="hempty">今天还没有训练记录<br>完成一次训练后会显示在这里</div>';
}

$('clearToday').onclick = () => {
  clearToday();
  renderToday();
  toast('今日记录已清空');
};

/* ============================================================
   计数事件处理
   ============================================================ */
function onProgress(value, now){
  const r = workout.addValue(value, now);
  if (r === 'rest') enterRest();
  else if (r === 'done') finishWorkout(true);
}

function handleCounter(out, now){
  for (const ev of out.events){
    if (ev.type === 'guide') guide(ev.msg);
    else if (ev.type === 'warn') warn(ev.msg);
    else if (ev.type === 'rep'){
      onProgress(1, now);
      if (workout.totalValue > 0 && workout.totalValue % 5 === 0) voice.say(String(workout.totalValue));
    } else if (ev.type === 'holdDone'){
      onProgress(ev.seconds, now);
      voice.say(Math.round(ev.seconds) + '秒', { gap: 1200 });
    }
  }

  if (!out.blocked){
    if (out.holding) setChip('保持 ' + out.holdSeconds.toFixed(1) + 's', 'good');
    else if (out.phase === 'bottom') setChip('发力中', 'good');
    else setChip('回位');
  }

  $('chipAngle').innerHTML = '角度 <b>' + (isNaN(out.angle) ? '—' : Math.round(out.angle) + '°') + '</b>';

  // HUD 数值
  const isHold = EXERCISES[state.ex].hold;
  const val = isHold ? workout.totalValue + out.holdSeconds : workout.totalValue;
  $('hudValue').textContent = isHold ? val.toFixed(1) : val;
  $('hudUnit').textContent = EXERCISES[state.ex].unit;
  $('setLine').textContent = workout.isTarget
    ? `第 ${workout.setIndex}/${workout.targetSets} 组 · 本组 ${Math.round(workout.setValue * 10) / 10}/${workout.targetPerSet}`
    : '自由练';
}

/* ============================================================
   主循环
   ============================================================ */
let tickCount = 0;
function loop(){
  requestAnimationFrame(loop);
  const now = performance.now();

  // 训练时钟 + 休息结束
  if (state.phase === 'training' || state.phase === 'resting'){
    const r = workout.tick(now);
    if (r === 'restEnd') leaveRest();
    if (state.phase === 'resting'){
      $('restNum').textContent = Math.ceil(workout.restLeft(now));
    }
    if (++tickCount % 15 === 0){
      $('recTime').textContent = fmtClock(workout.trainingMs / 1000);
    }
  }

  if (!engine.ready || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const res = engine.detect(now);
  if (!res) return;

  // 帧率统计
  frameTimes.push(now);
  while (frameTimes.length && now - frameTimes[0] > 1200) frameTimes.shift();
  if (frameTimes.length > 4){
    const fps = frameTimes.length / 1.2;
    $('fps').textContent = Math.round(fps) + ' fps';
    // 持续低帧率则降画质
    if (fps < CONFIG.minFps && engine.quality === 'high' && engine.stream){
      if (!lowFpsSince) lowFpsSince = now;
      else if (now - lowFpsSince > CONFIG.lowFpsMs){
        lowFpsSince = 0;
        engine.openCamera(engine.facing, 'low').then(() => {
          renderer.mirror = engine.mirror;
          syncBg();
          toast('已降低画质以保持流畅');
        }).catch(() => {});
      }
    } else lowFpsSince = 0;
  }

  const lmN = res.landmarks?.[0];
  const lmW = res.worldLandmarks?.[0];

  if (lmN){
    noPoseSince = 0;
    $('empty').classList.remove('show');
    const pts = smoother.apply(lmN);
    if (!window.__freezeDraw){
      renderer.draw(pts, state.ex, counter.cur, counter.phase, { skeleton: state.skeleton });
      renderer.focus(pts, counter.phase === 'bottom');
    }
    if (state.phase === 'training'){
      const out = counter.update(lmN, lmW, now);
      handleCounter(out, now);
    }
  } else {
    if (!window.__freezeDraw){ renderer.clear(); renderer.hideFocus(); }
    if (!noPoseSince) noPoseSince = now;
    else if (now - noPoseSince > CONFIG.noPoseMs && engine.stream){
      if (state.phase === 'training' || state.phase === 'live'){
        $('empty').classList.add('show');
        if (state.phase === 'training') setChip('未检测到人', 'bad');
      }
    }
  }
}

/* ============================================================
   生命周期
   ============================================================ */
document.addEventListener('visibilitychange', () => {
  if (document.hidden){
    voice.stop();
    // 切后台自动结束并保存，避免计时虚高
    if (state.phase === 'training' || state.phase === 'resting') finishWorkout(false);
  }
});

let wakeLock = null;
async function keepAwake(){
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('click', () => { if (!wakeLock) keepAwake(); }, { once: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
document.addEventListener('gesturestart', e => e.preventDefault());

// 仅移动端设计：桌面访问给提示但不阻断（便于调试）
if (!/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) && window.innerWidth > 900){
  const hint = document.createElement('div');
  hint.className = 'desktopHint show';
  hint.textContent = '本产品为手机设计，建议用手机浏览器打开';
  finder.appendChild(hint);
}

renderIdleHud();
applyToggles();
applyFit();
boot();

/* 调试出口：仅 ?debug=1 */
if (location.search.includes('debug')){
  window.__pose = {
    state, engine, counter, workout, smoother, renderer, voice,
    evalPose: (n, w) => counter.update(n, w, performance.now()),
    handle: (out) => handleCounter(out, performance.now()),
    setEx: k => selectExercise(k),
    start: () => startWorkout(),
    finish: () => finishWorkout(false),
    skipRest: () => { workout.skipRest(performance.now()); leaveRest(); },
    setNorm: (arr) => {
      smoother.reset();
      for (let i = 0; i < arr.length; i++){
        const p = arr[i] || { x:.5, y:.5, z:0, visibility:1 };
        smoother.pts[i] = { x: p.x, y: p.y, z: p.z || 0, v: p.visibility ?? 1 };
      }
    },
    angle
  };
}

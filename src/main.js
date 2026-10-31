import { EXERCISES } from './exercises.js';
import { RepCounter } from './counter.js';
import { LandmarkSmoother, fmtClock } from './math.js';
import { PoseEngine } from './pose-engine.js';
import { Renderer } from './renderer.js';
import { Workout } from './workout.js';
import { voice } from './voice.js';
import { saveSession, getSessions, prefs } from './store.js';
import { usablePose } from './session.js';

const $ = id => document.getElementById(id);
const video = $('video');
const renderer = new Renderer(video, $('overlay'), $('finder'), $('focus'));
const counter = new RepCounter();
const smoother = new LandmarkSmoother();
const workout = new Workout();
let preferredFacing='user';
let engine = null, phase = 'idle', ex = 'squat', generation = 0, raf = 0;
let lastFrame = 0, lastVideo = -1, stableSince = 0, lostSince = 0, resume = false;
let holdValue=0;
let restTimer = 0, orientation = prefs.get('orientation', 'portrait');
const labels = {squat:'深蹲',pushup:'俯卧撑',curl:'弯举',raise:'侧平举',plank:'平板支撑'};
const movements={
  squat:'<circle cx="28" cy="8" r="4"/><path d="M27 14 23 25 11 29 20 37H8M23 25l12 5-4 8h12M25 17l-9 2-5-5"/>',
  pushup:'<circle cx="9" cy="19" r="4"/><path d="m14 23 14 4 14 6M17 24l-4 13H6M41 33h5M27 27l-2 9h-8"/>',
  curl:'<circle cx="24" cy="8" r="4"/><path d="M24 14v14m0-10-9 7-6-8m15 1 9 7 6-8M24 28l-7 12m7-12 7 12M5 15h8m22 0h8"/>',
  raise:'<circle cx="24" cy="8" r="4"/><path d="M24 14v14M7 17l17 2 17-2M24 28l-7 12m7-12 7 12M4 14v6m40-6v6"/>',
  plank:'<circle cx="9" cy="23" r="4"/><path d="m14 26 14 2 14 5M17 27l-5 9H5m37-3 4 3h-8M20 28l-2 8h-6"/>'
};
$('exercises').innerHTML = Object.entries(labels).map(([k,v]) => `<button data-ex="${k}" aria-pressed="${k===ex}"><svg viewBox="0 0 48 48" aria-hidden="true">${movements[k]}</svg><span class="ex-label">${v}</span><span class="check" aria-hidden="true">✓</span></button>`).join('');
function notify(text){$('noticeText').textContent=text;$('notice').showModal();}
function feedback(text) { if ($('feedback').textContent !== text) $('feedback').textContent = text; }
function layout() {
  document.body.dataset.layout = orientation;
  document.querySelectorAll('#orientation [data-layout]').forEach(b => b.setAttribute('aria-pressed', b.dataset.layout === orientation));
  if (engine) engine.orientation = orientation;
  renderer.resize();
}
function choose(key) {
  ex = key; counter.setExercise(key);
  $('exerciseHint').textContent = EXERCISES[key].hint + (EXERCISES[key].needFoot ? '，确保身体完整入镜。' : '，上半身和手臂入镜即可。');
  $('unit').textContent = EXERCISES[key].unit;
  $('perSetLabel').textContent = EXERCISES[key].hold?'每组秒数':'每组次数';
  updateGoal();
  document.querySelectorAll('[data-ex]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ex === ex));
}
function controls() {
  const cameraActive = ['loading','positioning','countdown','training'].includes(phase);
  document.body.dataset.active = cameraActive;
  document.body.dataset.phase=phase;
  if(phase!=='idle' && !$('training').open)$('training').showModal();
  if(phase==='idle' && $('training').open)$('training').close();
  $('homeStart').disabled=phase!=='idle';
  $('placeholderTitle').textContent=({loading:'正在准备',paused:'休息一下',resting:'这一组，练得不错。'})[phase]||'准备好，再开始';
  $('placeholderText').textContent=phase==='paused'?'摄像头已关闭，点击继续重新准备。':phase==='resting'?'摄像头已关闭，按自己的节奏继续。':'正在加载模型与检查摄像头。';
  $('primary').disabled = phase === 'loading' || phase === 'countdown';
  $('primary').textContent = ({idle:'准备训练',loading:'正在准备…',positioning:'取消准备',countdown:'即将开始…',training:'暂停训练',paused:'继续训练',resting:'准备下一组'})[phase] || '准备训练';
  $('finish').hidden = phase === 'idle';
  $('finish').textContent='✕';
  $('finish').setAttribute('aria-label',resume?'结束并保存训练':'取消准备并返回');
  $('flip').hidden = !['positioning','training'].includes(phase);
  $('cameraStatus').textContent = cameraActive && phase !== 'loading' ? '摄像头使用中 · 本地分析' : '摄像头已关闭';
  $('phaseLabel').textContent = ({idle:'尚未开始',loading:'加载中',positioning:'调整站位',countdown:'准备开始',training:'训练中',paused:'已暂停',resting:'组间休息'})[phase];
  $('sessionTitle').textContent = phase === 'idle' ? '先准备，再开始' : labels[ex];
  for (const e of $('exercises').querySelectorAll('button')) e.disabled = phase !== 'idle';
  for (const id of ['mode','sets','perSet']) $(id).disabled = phase !== 'idle';
  if (phase === 'training') keepAwake(); else releaseWakeLock();
}
function stopCamera() {
  generation++; cancelAnimationFrame(raf); raf = 0; voice.stop();
  engine?.destroy(); engine = null;
  video.pause(); video.srcObject = null;
  $('finder').classList.remove('active'); $('countdown').hidden = true;
  renderer.clear(); renderer.hideFocus(); smoother.reset(); counter.reset();
  stableSince = 0; lostSince = 0; holdValue=0;
  releaseWakeLock();
}
async function prepare() {
  if (document.hidden) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { notify('摄像头需要 HTTPS，请使用 Safari 或 Chrome 打开。'); return; }
  if (!resume) {
    const sets=Number($('sets').value), perSet=Number($('perSet').value);
    if ($('mode').value==='target' && (!Number.isInteger(sets)||sets<1||sets>10||!Number.isInteger(perSet)||perSet<1||perSet>300)) {notify('请输入 1–10 组、每组 1–300 次或秒。');return;}
    workout.reset(); workout.configure({ex,mode:$('mode').value,sets,perSet}); renderProgress();
  }
  clearTimeout(restTimer); stopCamera();
  const token = generation; phase='loading'; controls();
  const localEngine = new PoseEngine(); engine=localEngine; localEngine.orientation=orientation;
  voice.enabled=$('voice').checked; voice.unlock();
  try {
    await localEngine.init(video,(p,msg)=>{if(token===generation) feedback(`${msg} · ${Math.round(p*100)}%`);});
    if(token!==generation){localEngine.destroy();return;}
    await localEngine.openCamera(preferredFacing,'low');
    if(token!==generation){localEngine.destroy();return;}
    renderer.mirror=localEngine.mirror; video.style.transform=renderer.mirror?'scaleX(-1)':'';
    renderer.resize(); lastFrame=0; lastVideo=-1; phase='positioning';
    $('finder').classList.add('active'); feedback(EXERCISES[ex].hint+'，稳定入镜后自动开始。'); controls();
    raf=requestAnimationFrame(frame);
  } catch(e) {
    localEngine.destroy();
    if(token!==generation)return;
    stopCamera(); phase=resume?'paused':'idle'; controls();
    notify(e.name==='NotAllowedError'?'摄像头权限未允许，请在浏览器中允许后重试。':'准备失败，请检查网络、摄像头是否被占用，然后重试。');
  }
}
function pause(message='已暂停，摄像头已关闭。点击继续后重新检查站位。') {
  if(phase==='training'){workout.tick(performance.now());if(holdValue>0)workout.addValue(holdValue,performance.now());}
  stopCamera(); phase=resume?'paused':'idle'; controls(); feedback(message);
}
function finish() {
  clearTimeout(restTimer);
  const now=performance.now();
  if(phase==='training' && holdValue>0)workout.addValue(holdValue,now);
  if(phase!=='training') workout.lastTickAt=now;
  const summary=resume?workout.finish(now):null;
  stopCamera(); phase='idle';resume=false;controls();
  if(summary){
    const saved=summary.totalValue>0?saveSession(summary):true;
    $('summaryText').textContent=`${labels[summary.ex]} · ${Math.round(summary.totalValue*10)/10} ${summary.unit} · 有效训练 ${fmtClock(summary.seconds)}`+(saved?'':'（本机记录保存失败）');
    $('summary').showModal();
  }
  feedback('摄像头已关闭。准备好后可以再练一组。');
}
function renderProgress(hold=0) {
  $('count').textContent=Math.round((workout.totalValue+hold)*10)/10;
  $('clock').textContent=fmtClock(workout.trainingMs/1000);
  $('progress').textContent=workout.isTarget?`${workout.setIndex}/${workout.targetSets} 组`:'自由练';
}
function progress(value,now) {
  holdValue=0;
  const result=workout.addValue(value,now);
  if(result==='done'){finish();return;}
  if(result==='rest'){
    stopCamera();phase='resting';controls();
    function updateRest(){
      if(phase!=='resting')return;
      const left=Math.ceil(workout.restLeft(performance.now()));
      feedback(left>0?`本组完成，休息 ${left} 秒。摄像头已关闭。`:'休息完成，点击准备下一组。');
      if(left>0)restTimer=setTimeout(updateRest,1000);
    }
    updateRest();
  }
}
function frame(now) {
  if(!engine || !['positioning','countdown','training'].includes(phase))return;
  raf=requestAnimationFrame(frame);
  if(now-lastFrame<1000/12 || video.readyState<2 || video.currentTime===lastVideo)return;
  lastFrame=now; lastVideo=video.currentTime;
  const result=engine.detect(now), n=result?.landmarks?.[0], w=result?.worldLandmarks?.[0];
  const ready=usablePose(n,ex);
  if(!ready){
    renderer.clear();stableSince=0;$('countdown').hidden=true;
    if(phase==='countdown'){phase='positioning';controls();}
    if(!lostSince)lostSince=now;
    if(phase==='training'){workout.lastTickAt=now;if(holdValue>0){progress(holdValue,now);holdValue=0;counter.reset();if(phase!=='training')return;}}
    feedback(n?'请调整站位，让需要的关节清晰入镜。':'暂时看不清身体，请按动作提示站进画面。');
    if(now-lostSince>20000)pause('长时间未清晰入镜，摄像头已关闭。调整手机后点击继续。');
    return;
  }
  const pts=smoother.apply(n);
  renderer.draw(pts,ex,counter.cur,counter.phase,{skeleton:$('skeleton').checked});
  if(phase==='positioning'||phase==='countdown'){
    const probe=counter.update(n,w,now);counter.reset();
    if(probe.blocked){stableSince=0;phase='positioning';$('countdown').hidden=true;feedback(probe.events[0]?.msg||'请调整站位');if(!lostSince)lostSince=now;if(now-lostSince>20000)pause('站位未就绪，摄像头已关闭。调整手机后重新准备。');return;}
    lostSince=0;
    if(!stableSince)stableSince=now;
    const elapsed=now-stableSince;
    if(elapsed<1000){feedback('站位合适，请保持，马上开始。');return;}
    phase='countdown';controls();$('countdown').hidden=false;
    $('countdown').textContent=String(Math.max(1,Math.ceil((4000-elapsed)/1000)));
    if(elapsed<4000)return;
    $('countdown').hidden=true;
    if(!resume){workout.start(now);resume=true;} else {workout.state='training';workout.lastTickAt=now;}
    counter.reset();smoother.reset();phase='training';controls();voice.say('开始');
  }
  const out=counter.update(n,w,now);
  if(out.blocked){workout.lastTickAt=now;feedback(out.events[0]?.msg||'请调整站位');if(!lostSince)lostSince=now;if(now-lostSince>20000)pause('站位未就绪，摄像头已关闭。调整手机后继续。');return;}
  lostSince=0;
  workout.tick(now);
  holdValue=out.holding?out.holdSeconds:0;
  const notice=out.events.find(e=>e.type==='warn');
  feedback(notice?.msg || (out.holding?'保持稳定，正常呼吸。':'按自己的节奏完成动作。'));
  if(notice)voice.say(notice.msg,{gap:4000});
  for(const event of out.events){
    if(event.type==='rep'){voice.say(String(workout.totalValue+1),{gap:500});progress(1,now);}
    if(event.type==='holdDone')progress(event.seconds,now);
    if(phase!=='training')break;
  }
  renderProgress(phase==='training'?out.holdSeconds:0);
  if(ex==='plank' && phase==='training' && workout.isTarget && out.holdSeconds>=workout.targetPerSet-workout.setValue) progress(out.holdSeconds,now);
}
$('primary').onclick=()=>{
  if(phase==='training'||phase==='positioning')pause();
  else if(['idle','paused','resting'].includes(phase))prepare();
};
$('finish').onclick=finish;
$('homeStart').onclick=prepare;
$('training').addEventListener('cancel',e=>{e.preventDefault();pause();});
$('flip').onclick=async()=>{
  if(!engine || phase==='loading')return;
  // Re-enter preparation so switching cameras cannot create a counted repetition.
  const facing=engine.facing==='user'?'environment':'user';
  pause('正在切换镜头…');
  preferredFacing=facing; await prepare();
};
$('exercises').onclick=e=>{const b=e.target.closest('[data-ex]');if(b&&phase==='idle')choose(b.dataset.ex);};
$('mode').onchange=()=>{$('targets').hidden=$('mode').value!=='target';updateGoal();};
$('sets').onchange=updateGoal;
$('perSet').onchange=updateGoal;
$('orientation').onclick=e=>{const b=e.target.closest('[data-layout]');if(!b)return;orientation=b.dataset.layout;prefs.set('orientation',orientation);layout();};
$('voice').checked=prefs.get('voice',false);
$('voice').onchange=()=>{voice.enabled=$('voice').checked;prefs.set('voice',voice.enabled);if(voice.enabled){voice.unlock();voice.say('语音已开启');}else voice.stop();};
function updateGoal(){
  $('goalLabel').textContent=$('mode').value==='target'?`${$('sets').value} 组 × ${$('perSet').value} ${EXERCISES[ex].unit}`:'自由练习';
}
function openSettings(){if(['loading','positioning','countdown','training'].includes(phase))pause();$('settings').showModal();}
$('settingsBtn').onclick=openSettings;
$('goalBtn').onclick=openSettings;
$('trainingSettings').onclick=openSettings;
$('settingsClose').onclick=()=>{$('settings').close();updateGoal();};
$('helpBtn').onclick=()=>$('help').showModal();
$('helpClose').onclick=()=>$('help').close();
$('noticeClose').onclick=()=>$('notice').close();
$('summaryClose').onclick=()=>$('summary').close();
$('again').onclick=()=>{$('summary').close();prepare();};
$('historyBtn').onclick=()=>{
  $('historyList').replaceChildren();
  const sessions=getSessions().slice().reverse();
  if(!sessions.length)$('historyList').textContent='今天还没有训练记录。';
  for(const s of sessions){const row=document.createElement('div');row.className='history-row';row.textContent=`${labels[s.ex]||s.ex} · ${Math.round(s.totalValue*10)/10} ${s.unit} · ${fmtClock(s.seconds)}`;$('historyList').append(row);}
  $('history').showModal();
};
$('historyClose').onclick=()=>$('history').close();
let wakeLock=null;
async function keepAwake(){try{if(!wakeLock && 'wakeLock' in navigator){const lock=await navigator.wakeLock.request('screen');if(phase!=='training'){await lock.release();return;}wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});}}catch{}}
function releaseWakeLock(){wakeLock?.release().catch(()=>{});wakeLock=null;}
document.addEventListener('visibilitychange',()=>{if(document.hidden){voice.stop();if(['loading','positioning','countdown','training'].includes(phase))pause('已暂停并关闭摄像头。返回后点击继续。');}});
window.addEventListener('pagehide',()=>{clearTimeout(restTimer);stopCamera();});
choose(ex);layout();controls();

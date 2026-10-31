import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { RepCounter } from '../src/counter.js';
import { Workout } from '../src/workout.js';
import { EXERCISES } from '../src/exercises.js';
import { LandmarkSmoother, fmtClock } from '../src/math.js';
import { usablePose } from '../src/session.js';

const ids=[...fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
const elements=new Map(ids.map(id=>[id,{textContent:'',value:({mode:'free',sets:'3',perSet:'15'})[id]||'',checked:false,hidden:false,dataset:{},style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],setAttribute(){},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},pause(){},play:async()=>{},showModal(){this.open=true;},close(){this.open=false;},replaceChildren(){},append(){}}]));
const video=elements.get('video');video.readyState=4;video.currentTime=0;
const callbacks=new Map(), events={}, instances=[];let now=100, seq=0, fail=false, pending=null;
let points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));
for(const i of [11,12])points[i]={x:.5,y:.2,z:0,visibility:1};
for(const i of [27,28])points[i]={x:.5,y:.9,z:0,visibility:1};
class MockEngine {
 constructor(){instances.push(this);this.facing='user';}
 async init(){if(pending)await pending;if(fail)throw new Error('failure');this.ready=true;}
 async openCamera(){this.stream={active:true};this.mirror=true;}
 detect(){return {landmarks:[points]};}
 destroy(){if(this.stream)this.stream.active=false;this.stream=null;this.destroyed=true;}
}
const context=vm.createContext({console,EXERCISES,RepCounter,Workout,LandmarkSmoother,fmtClock,usablePose,PoseEngine:MockEngine,Renderer:class{resize(){}clear(){}hideFocus(){}draw(){}},voice:{unlock(){},say(){},stop(){}},prefs:{get:(k,v)=>v,set(){}},saveSession:()=>true,getSessions:()=>[],performance:{now:()=>now},requestAnimationFrame:cb=>{callbacks.set(++seq,cb);return seq;},cancelAnimationFrame:id=>callbacks.delete(id),setTimeout:()=>++seq,clearTimeout(){},navigator:{mediaDevices:{getUserMedia(){}}},window:{isSecureContext:true,addEventListener(){}},document:{hidden:false,body:{dataset:{}},getElementById:id=>{assert(elements.has(id),`Unknown DOM id ${id}`);return elements.get(id);},querySelectorAll:()=>[],addEventListener:(e,cb)=>events[e]=cb,createElement:()=>({})}});
const code=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
vm.runInContext(code,context);
const run=code=>vm.runInContext(code,context);
function step(t){now=t;video.currentTime=t/1000;const queue=[...callbacks.values()];callbacks.clear();for(const fn of queue)fn(t);}
assert.equal(elements.get('training').open,undefined);assert.equal(instances.length,0,'idle must not initialize AI or camera');assert.equal(callbacks.size,0);
await run('prepare()');assert.equal(elements.get('training').open,true);assert.equal(run('phase'),'positioning');assert.equal(instances.length,1);
step(100);step(1200);assert.equal(run('phase'),'countdown');step(4300);assert.equal(run('phase'),'training');
run('openSettings()');assert.equal(elements.get('settings').open,true);assert.equal(run('phase'),'paused');run("$('settings').close()");assert.equal(callbacks.size,0);assert(instances[0].destroyed);assert.equal(video.srcObject,null);
const elapsed=run('workout.trainingMs');now=30000;assert.equal(run('workout.trainingMs'),elapsed,'pause excludes wall time');
await run('prepare()');step(30100);step(34300);assert.equal(run('phase'),'training');
context.document.hidden=true;events.visibilitychange();assert.equal(run('phase'),'paused');assert.equal(callbacks.size,0);assert(instances[1].destroyed);context.document.hidden=false;
run('finish()');assert.equal(run('phase'),'idle');assert.equal(elements.get('training').open,false);assert.equal(callbacks.size,0);
fail=true;await run('prepare()');assert.equal(run('phase'),'idle');assert(instances.at(-1).destroyed);fail=false;
let resolve;pending=new Promise(r=>resolve=r);const loading=run('prepare()');run('finish()');resolve();await loading;pending=null;assert.equal(run('phase'),'idle');assert(instances.at(-1).destroyed);assert.equal(callbacks.size,0);
await run('prepare()');step(35000);step(39200);run("workout.mode='target';workout.targetSets=2;workout.targetPerSet=1;progress(1,performance.now())");assert.equal(run('phase'),'resting');assert(instances.at(-1).destroyed);assert.equal(callbacks.size,0);run('finish()');
assert.equal(usablePose(null,'squat'),false);const partial=points.map(p=>({...p}));partial[27].visibility=partial[28].visibility=0;assert.equal(usablePose(partial,'squat'),false);
console.log('PASS: idle, preparation/countdown, pause/resume, background, finish, initialization failure, cancelled initialization, rest cleanup, low-confidence gate. Camera/model are mocks; no thermal or real-camera claim.');

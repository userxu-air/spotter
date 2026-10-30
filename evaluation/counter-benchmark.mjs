import { performance } from 'node:perf_hooks';
import { RepCounter } from '../src/counter.js';

// Synthetic landmarks exercise the downstream counter, not MediaPipe inference.
function pose(degrees) {
  const n = Array.from({length: 33}, () => ({x: .5, y: .5, z: 0, visibility: 1}));
  n[11] = {x:.4,y:.2,z:0,visibility:1}; n[12] = {x:.6,y:.2,z:0,visibility:1};
  n[23] = {x:.4,y:.5,z:0,visibility:1}; n[24] = {x:.6,y:.5,z:0,visibility:1};
  n[25] = {x:.4,y:.65,z:0,visibility:1}; n[26] = {x:.6,y:.65,z:0,visibility:1};
  n[27] = {x:.4,y:.9,z:0,visibility:1}; n[28] = {x:.6,y:.9,z:0,visibility:1};
  const w = n.map(p => ({...p}));
  const rad = degrees * Math.PI / 180;
  for (const [hip,knee,ankle,x] of [[23,25,27,.4],[24,26,28,.6]]) {
    w[knee] = {x,y:.5,z:0}; w[hip] = {x,y:.4,z:0};
    w[ankle] = {x:x+Math.sin(rad)*.1,y:.5-Math.cos(rad)*.1,z:0};
  }
  return [n,w];
}
const high = pose(175), low = pose(75);
const counter = new RepCounter('squat');
let frames = 0; const times = [];
function feed(poseData, n) { for(let i=0;i<n;i++){ const t=performance.now(); counter.update(...poseData,frames++ * 33); times.push(performance.now()-t); } }
feed(high,20);
for(let i=0;i<10;i++){feed(low,20);feed(high,20);}
const actual = counter.count;
const staticCounter = new RepCounter('squat');
for(let i=0;i<400;i++) staticCounter.update(...high,i*33);
const sorted=times.slice().sort((a,b)=>a-b);
const pct=p=>sorted[Math.ceil(sorted.length*p)-1];
console.log(JSON.stringify({node:process.version,platform:process.platform,frames,expectedReps:10,actualReps:actual,staticFrames:400,staticFalseReps:staticCounter.count,updateMsMedian:pct(.5),updateMsP95:pct(.95)},null,2));
if(actual!==10 || staticCounter.count!==0) process.exitCode=1;

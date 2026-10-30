import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.10.14';
const TTY = process.stdout.isTTY;

const FILES = [
  {
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`,
    out: 'assets/vision_bundle.mjs'
  },
  ...['vision_wasm_internal', 'vision_wasm_nosimd_internal'].flatMap(name => ([
    {
      url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/${name}.js`,
      out: `assets/wasm/${name}.js`
    },
    {
      url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/${name}.wasm`,
      out: `assets/wasm/${name}.wasm`
    }
  ])),
  {
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    out: 'assets/models/pose_landmarker_lite.task'
  }
];

const mb = n => (n / 1048576).toFixed(1) + 'MB';

async function download(url, out){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);

  // gzip 传输时 content-length 是压缩后大小，百分比会失真，此时只报已下载量
  const total = Number(res.headers.get('content-length')) || 0;
  const compressed = !!res.headers.get('content-encoding');
  await mkdir(dirname(out), { recursive: true });

  let received = 0, lastAt = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', chunk => {
    received += chunk.length;
    if (!TTY) return;
    const now = Date.now();
    if (now - lastAt < 200) return;
    lastAt = now;
    const pct = (!compressed && total) ? Math.round(received / total * 100) + '%  ' : '';
    process.stdout.write(`\r  ${mb(received)}  ${pct}${out}                    `);
  });

  await pipeline(body, createWriteStream(out));
  if (TTY) process.stdout.write('\r');
  console.log(`  ${mb(received)}  ${out}`);
}

console.log('下载 MediaPipe 运行时与姿态模型（约 24MB）…\n');
try {
  for (const f of FILES) await download(f.url, join(ROOT, f.out));

  let sum = 0;
  for (const f of FILES) sum += (await stat(join(ROOT, f.out))).size;
  console.log(`\n全部就绪，共 ${mb(sum)}。`);
  console.log('运行 npm start 后打开 http://localhost:8899');
} catch (e) {
  await rm(join(ROOT, 'assets'), { recursive: true, force: true });
  console.error('\n下载失败：' + e.message);
  console.error('检查网络后重试：npm run fetch-assets');
  process.exit(1);
}

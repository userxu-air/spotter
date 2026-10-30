import { CONFIG } from './config.js';

/** 带进度下载，返回 ArrayBuffer */
async function download(url, onProgress){
  const res = await fetch(url);
  if (!res.ok) throw new Error('模型下载失败 (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total){
    const buf = await res.arrayBuffer();
    onProgress?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;){
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(1, received / total));
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks){ buf.set(c, offset); offset += c.length; }
  return buf.buffer;
}

/** 姿态引擎：模型加载（含降级）+ 摄像头管理 */
export class PoseEngine {
  constructor(){
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.delegate = null;
    this.facing = 'user';
    this.mirror = true;
    this.quality = 'low';
    this.cameraGeneration = 0;
  }

  get ready(){ return !!this.landmarker; }

  async init(video, onProgress){
    this.video = video;
    onProgress?.(0.04, '正在加载推理引擎');
    const { PoseLandmarker, FilesetResolver } = await import(CONFIG.bundlePath);
    const fileset = await FilesetResolver.forVisionTasks(CONFIG.wasmPath);

    onProgress?.(0.30, '正在下载姿态模型');
    const buf = await download(CONFIG.modelPath, p => onProgress?.(0.30 + p * 0.62, '正在下载姿态模型'));

    onProgress?.(0.94, '正在初始化');
    // GPU 优先；部分机型 WebGL 上下文创建失败，自动回退 CPU
    try {
      this.landmarker = await this.create(PoseLandmarker, fileset, buf, 'GPU');
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('GPU 初始化失败，回退 CPU', e);
      this.landmarker = await this.create(PoseLandmarker, fileset, buf, 'CPU');
      this.delegate = 'CPU';
    }
    onProgress?.(1, this.delegate === 'CPU' ? '就绪（兼容模式）' : '模型就绪');
    return this.delegate;
  }

  create(PoseLandmarker, fileset, buf, delegate){
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(buf), delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  async openCamera(facing = this.facing, quality = this.quality){
    this.stopTracks();
    const cameraGeneration = this.cameraGeneration;
    let cameraStream;
    this.facing = facing;
    this.quality = quality;
    const portrait = this.orientation !== 'landscape';
    // 传感器原生多为 4:3。请求 9:16 会被系统横向裁切（视野变窄，像开了 1.8x 变焦）。
    // 这里用 3:4 / 4:3，视野更接近原生，再交给显示层决定裁切方式。
    const size = quality === 'low'
      ? (portrait ? { width: { ideal: 640 }, height: { ideal: 853 } }
                  : { width: { ideal: 853 }, height: { ideal: 640 } })
      : (portrait ? { width: { ideal: 960 }, height: { ideal: 1280 } }
                  : { width: { ideal: 1280 }, height: { ideal: 960 } });

    const base = { ...size, frameRate: { ideal: 15, max: 15 } };
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { ...base, facingMode: { ideal: facing } }, audio: false
      });
    } catch (e) {
      // 权限类错误直接上抛，由 UI 给出引导；其余按无 facingMode 重试
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError') throw e;
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
    }

    if(cameraGeneration !== this.cameraGeneration){
      cameraStream.getTracks().forEach(t => t.stop());
      throw new DOMException('Camera request cancelled', 'AbortError');
    }
    this.stream = cameraStream;
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.mirror = (facing === 'user');
    await new Promise(r => setTimeout(r, 280));
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  async flip(){
    return this.openCamera(this.facing === 'user' ? 'environment' : 'user');
  }

  detect(ts){
    if (!this.landmarker || this.video.readyState < 2) return null;
    try { return this.landmarker.detectForVideo(this.video, ts); }
    catch { return null; }
  }

  stopTracks(){
    this.cameraGeneration++;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  destroy(){
    this.stopTracks();
    try { this.landmarker?.close(); } catch {}
    this.landmarker = null;
  }
}

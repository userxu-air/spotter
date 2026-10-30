/* 全局配置：只放真正需要集中调整的项 */
export const CONFIG = {
  modelPath: './assets/models/pose_landmarker_lite.task',
  wasmPath: './assets/wasm',
  // 供 src/ 下的模块做动态 import：相对模块 URL 解析，故需先回退一级
  bundlePath: '../assets/vision_bundle.mjs',

  restSeconds: 40,            // 组间休息默认时长
  minFps: 14,                 // 低于此帧率持续一段时间则降画质
  lowFpsMs: 6000,
  noPoseMs: 5000,             // 持续检测不到人则提示

  // 平滑参数：动作快时跟得上，静止时强滤波
  smooth: {
    lmBase: 0.34, lmMax: 0.95, lmScale: 16,
    angBase: 0.20, angMax: 0.92, angScale: 0.6 / 65
  },

  storageKey: 'posecoach.v2'
};

# 姿势教练 · Pose Coach

手机浏览器打开就能用的 AI 健身动作识别器。摄像头实时捕捉 33 个人体关键点，自动计数、纠正动作，**全部在本机计算，画面不上传**。

不需要装 App，不需要账号，不需要联网分析。

<img src="screenshots/spotter-clean.png" width="390" alt="Spotter 简洁训练界面" />

## 能做什么

| 动作 | 判定依据 |
|---|---|
| 深蹲 | 髋-膝-踝夹角，蹲到底 <105°，站直 >158° |
| 俯卧撑 | 肩-肘-腕夹角，下放 <95°，撑起 >155° |
| 弯举 | 肩-肘-腕夹角，弯到位 <62° |
| 侧平举 | 髋-肩-肘夹角，抬起 >78° |
| 平板支撑 | 肩-髋-膝成一条直线，按秒计时 |

**动作纠错**：膝盖内扣、塌腰、翘臀、幅度不足、蹲太浅
**站位引导**：脚未入镜、距离太远/太近，直接提示调整
**训练闭环**：自由练或定目标（组数 × 每组量）→ 组间休息 → 完成总结 → 今日记录

## 体验与新版界面

[在线体验（WorkBuddy）](https://pose-coach-42598.app.workbuddy.host/?sharecode=L6WEF567T2)

此链接为现有托管版本；GitHub 中的新版需要在 WorkBuddy 重新部署后才会出现在该链接中。

新版采用简洁的训练页面，默认竖屏，可在「训练选项」中切换横屏布局。手机浏览器不一定支持程序锁定屏幕方向，选择横屏后请同时转动手机。偏好会保存在本机。

## 在手机上用

1. 用 Safari 或 Chrome 打开页面，选择动作；需要时设置训练目标和语音。
2. 点击「准备训练」，按提示允许摄像头。
3. 按动作提示摆好手机、完整入镜；站位稳定后自动倒计时 3 秒开始。
4. 暂停时摄像头关闭；继续训练会重新检查站位。结束后查看本机记录。

全身动作需要脚入镜；弯举和侧平举只需上半身及相关手臂入镜。

首次准备需要加载约 24MB 的模型与运行时，建议使用 Wi-Fi。首页不自动加载模型或打开摄像头。

### 资源使用

- 摄像头仅在准备、倒计时和训练阶段使用；暂停、结束、组间休息及切到后台时停止采集并释放模型。
- 移除了模糊背景视频、构图网格和伪录像界面；默认请求低分辨率、15 fps 相机，推理最多 12 次/秒。
- 20 秒未清晰入镜或站位不合格时自动关闭摄像头；继续需用户主动操作。
- 这些措施用于减少持续负载，尚未在真实手机上测量温度、电量和识别延迟。训练过程中摄像头仍需工作。

## 本地运行

```bash
npm run fetch-assets   # 下载 MediaPipe 运行时与模型（约 24MB）
npm start              # 启动本地服务
```

打开 http://localhost:8899

> 摄像头需要 HTTPS 或 localhost。用手机访问电脑的局域网 IP 时，浏览器会拦截摄像头，需要自己配证书或部署到 HTTPS。

## 技术实现

- **推理**：MediaPipe Tasks Vision（`pose_landmarker_lite`），WebAssembly + WebGL
- **角度计算**：优先使用 `worldLandmarks`（米制 3D 坐标），避免 2D 投影带来的透视畸变
- **平滑**：关节坐标与角度双自适应 EMA，动作快时跟得上、静止时不抖
- **计数**：关节角状态机 + 滞回阈值，幅度不足不计入
- **零依赖**：没有前端框架、没有构建步骤、没有 npm 运行时依赖

```
src/
  config.js      配置常量
  math.js        角度、距离、平滑滤波
  exercises.js   动作定义与判定规则
  counter.js     计数状态机（纯逻辑，返回事件）
  workout.js     组数、休息、完成、总结
  pose-engine.js 模型加载（含降级）+ 摄像头
  renderer.js    骨架绘制与对焦框
  voice.js       语音播报
  store.js       本地记录
  main.js        流程组装
```

## 已知限制

- **单目摄像头**：只有 2D 画面 + 估算深度，侧面看不到的三维问题（如膝关节内扣）判不出来
- **需要固定机位**：手机要架稳，手持或走动会失效
- **iOS 不支持变焦**：`MediaStreamTrack` 的 `zoom` 约束在 Safari 上不可用，只能靠移动手机
- **模型是 lite 版**：为速度牺牲了精度，换 `pose_landmarker_full` 可提升准确度但帧率下降
- **数据只在本机**：记录存 localStorage，换设备或清浏览器数据就没了

## 许可

代码 MIT。内置的 MediaPipe 运行时与模型为 Apache-2.0，详见 [NOTICE](NOTICE)。

## English overview

Spotter is a mobile browser fitness companion for beginners who exercise at home and lack live feedback. It estimates body landmarks locally, counts repetitions or holds, and offers basic rule-based positioning and form cues. Camera frames are processed on-device; workout history stays in local storage.

**Why this stack:** MediaPipe Pose Landmarker Lite and WebAssembly/WebGL support on-device inference without a server. Plain HTML, CSS and JavaScript keep setup simple. The counter uses estimated 3D world landmarks where available, adaptive smoothing and threshold hysteresis to reduce jitter and repeated counts.

**Evaluation (2026-10-30):** A reproducible synthetic-landmark test counted 10 of 10 squat cycles, produced 0 false counts across 400 stationary frames, and measured counter update time at 0.0062 ms p95 on a Windows desktop (Node 24, Intel i7-14700F). These are counter-only results, not camera-to-feedback latency or pose-estimation accuracy. Real-user accuracy, mobile latency and improvement in exercise form have not yet been measured. See [evaluation details](evaluation/RESULTS.md) and [product definition](PRODUCT.md).

**Run locally:** `npm run fetch-assets`, then `npm start`. Open `http://localhost:8899`; camera access on a phone requires HTTPS or localhost. This tool is not medical advice or a substitute for a qualified trainer.

The redesigned UI defaults to portrait and offers a landscape layout. Camera and inference are started on demand and released on pause, rest, completion, backgrounding or failed setup. A 12 Hz inference cap and a 15 fps camera request reduce continuous work; on-device thermal and battery improvements remain unmeasured.

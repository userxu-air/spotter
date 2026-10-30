/* 中文语音播报。iOS 需要用户手势后才能出声，故有点击时解锁。 */
class Voice {
  constructor(){
    this.enabled = true;
    this.unlocked = false;
    this.zh = null;
    this.lastAt = 0;
    this.supported = 'speechSynthesis' in window;
    if (this.supported){
      const pick = () => {
        const vs = speechSynthesis.getVoices() || [];
        this.zh = vs.find(v => /zh[-_]CN|Chinese|中文|普通话/i.test(v.lang + v.name)) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  unlock(){
    if (this.unlocked || !this.supported) return;
    this.unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; u.lang = 'zh-CN';
      speechSynthesis.speak(u);
    } catch {}
  }

  say(text, { force = false, gap = 900 } = {}){
    // 开关优先：关闭时任何调用都不出声（force 只用于跳过节流）
    if (!this.supported || !this.enabled) return;
    const now = performance.now();
    if (!force && now - this.lastAt < gap) return;
    this.lastAt = now;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (this.zh) u.voice = this.zh;
      u.rate = 1.12; u.volume = 1;
      speechSynthesis.speak(u);
    } catch {}
  }

  stop(){
    if (!this.supported) return;
    try { speechSynthesis.cancel(); } catch {}
  }
}

export const voice = new Voice();

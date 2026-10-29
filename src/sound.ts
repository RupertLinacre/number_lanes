type SoundEffect = "hop" | "correct" | "wrong" | "hit" | "splash" | "swap";

export class GameSound {
  private context?: AudioContext;
  private enabled = localStorage.getItem("hop-lane-sound") !== "off";

  private readonly unlock = (): void => {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") void this.context.resume();
    } catch {
      // Audio is optional when the browser cannot create an audio context.
    }
  };

  constructor() {
    window.addEventListener("keydown", this.unlock);
    window.addEventListener("pointerdown", this.unlock);
  }

  get isEnabled(): boolean { return this.enabled; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem("hop-lane-sound", enabled ? "on" : "off");
    if (enabled) this.unlock();
    else if (this.context?.state === "running") void this.context.suspend();
  }

  play(effect: SoundEffect): void {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    switch (effect) {
      case "hop": this.tone(now, 360, 560, 0.1, "sine", 0.055); break;
      case "correct":
        this.tone(now, 523, 523, 0.1, "sine", 0.06);
        this.tone(now + 0.09, 784, 784, 0.16, "sine", 0.06);
        break;
      case "wrong": this.tone(now, 220, 170, 0.18, "triangle", 0.045); break;
      case "hit": this.tone(now, 130, 55, 0.3, "sawtooth", 0.05); break;
      case "splash":
        this.noise(now, 0.42);
        this.tone(now, 240, 80, 0.28, "sine", 0.04);
        break;
      case "swap": this.tone(now, 440, 620, 0.15, "triangle", 0.04); break;
    }
  }

  private tone(start: number, from: number, to: number, duration: number, type: OscillatorType, volume: number): void {
    const ctx = this.context!;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  private noise(start: number, duration: number): void {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1300, start);
    filter.frequency.exponentialRampToValueAtTime(300, start + duration);
    gain.gain.setValueAtTime(0.04, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(start);
    source.stop(start + duration);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.unlock);
    window.removeEventListener("pointerdown", this.unlock);
    if (this.context) void this.context.close();
  }
}

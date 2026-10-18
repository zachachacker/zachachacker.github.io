/**
 * Microphone level meter and voice-activity detector built on the Web Audio
 * API. Used for the waveform with every provider, and as the activity signal
 * for the OpenAI provider (which has no live recogniser).
 */

export interface LevelMeterHandle {
  stream: MediaStream;
  stop(): void;
}

export interface LevelCallbacks {
  onLevel(level: number): void;
  /** Called on each frame where the input looks like voice rather than room noise. */
  onVoice?(): void;
}

export async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export function startLevelMeter(stream: MediaStream, cb: LevelCallbacks): () => void {
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  // Noise floor adapts slowly to the room, so steady background noise doesn't count as speech.
  let floor = 0.01;
  let voiceFrames = 0;
  let stopped = false;
  const timer = window.setInterval(() => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const isVoice = rms > Math.max(floor * 3, 0.02);
    if (!isVoice) floor = floor * 0.95 + rms * 0.05;
    else floor = floor * 0.999 + rms * 0.001;
    // Require a few consecutive frames so clicks and bumps don't register.
    voiceFrames = isVoice ? voiceFrames + 1 : 0;
    if (voiceFrames >= 3) cb.onVoice?.();
    cb.onLevel(Math.min(1, rms * 8));
  }, 50);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    source.disconnect();
    void ctx.close().catch(() => undefined);
  };
}

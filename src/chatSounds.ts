/** Short tones for messages from other people. One switch per channel. */

export type ChatSound = "floor" | "office" | "whisper";

const KEY: Record<ChatSound, string> = {
  floor: "haw-sound-floor",
  office: "haw-sound-office",
  whisper: "haw-sound-whisper",
};

type Tone = { freq: number; at: number; dur: number; gain: number };

const TONES: Record<ChatSound, Tone[]> = {
  floor: [
    { freq: 740, at: 0, dur: 0.08, gain: 0.2 },
    { freq: 988, at: 0.09, dur: 0.12, gain: 0.2 },
  ],
  office: [
    { freq: 523, at: 0, dur: 0.1, gain: 0.38 },
    { freq: 784, at: 0, dur: 0.1, gain: 0.16 },
    { freq: 659, at: 0.11, dur: 0.14, gain: 0.38 },
    { freq: 1046, at: 0.11, dur: 0.14, gain: 0.18 },
  ],
  whisper: [{ freq: 1318, at: 0, dur: 0.08, gain: 0.14 }],
};

/** Your own shift moments. These are not muted by the chat switches. */
const CHIMES: Record<"shift" | "claim" | "clockout", Tone[]> = {
  shift: [
    { freq: 523, at: 0, dur: 0.12, gain: 0.22 },
    { freq: 659, at: 0.12, dur: 0.12, gain: 0.22 },
    { freq: 784, at: 0.24, dur: 0.2, gain: 0.24 },
  ],
  claim: [
    { freq: 659, at: 0, dur: 0.1, gain: 0.24 },
    { freq: 880, at: 0.1, dur: 0.18, gain: 0.26 },
  ],
  clockout: [
    { freq: 784, at: 0, dur: 0.14, gain: 0.2 },
    { freq: 659, at: 0.16, dur: 0.14, gain: 0.18 },
    { freq: 523, at: 0.32, dur: 0.28, gain: 0.16 },
  ],
};

let ctx: AudioContext | null = null;

export function chatSoundOn(kind: ChatSound) {
  try {
    return localStorage.getItem(KEY[kind]) !== "0";
  } catch {
    return true;
  }
}

export function setChatSound(kind: ChatSound, on: boolean) {
  try {
    localStorage.setItem(KEY[kind], on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function audioContext() {
  const AudioCtx = window.AudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

export function unlockChatSounds() {
  const audio = audioContext();
  if (audio && audio.state === "suspended") void audio.resume();
}

function schedule(audio: AudioContext, tones: Tone[]) {
  const now = audio.currentTime;
  for (const tone of tones) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = tone.freq;
    const start = now + tone.at;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(start);
    osc.stop(start + tone.dur + 0.02);
  }
}

function playTones(tones: Tone[], still?: () => boolean) {
  const audio = audioContext();
  if (!audio) return;
  const run = () => {
    if (audio.state === "running" && (still?.() ?? true)) schedule(audio, tones);
  };
  if (audio.state === "suspended") {
    void audio.resume().then(run);
    return;
  }
  run();
}

export function playChatSound(kind: ChatSound) {
  if (!chatSoundOn(kind)) return;
  playTones(TONES[kind], () => chatSoundOn(kind));
}

export function playChime(kind: keyof typeof CHIMES) {
  playTones(CHIMES[kind]);
}

window.addEventListener("pointerdown", unlockChatSounds);
window.addEventListener("keydown", unlockChatSounds);

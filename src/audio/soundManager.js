/**
 * 효과음 관리 (Web Audio)
 * ------------------------------------------------------------
 * - 브라우저 자동 재생 제한 때문에, 사용자가 처음 클릭하거나 키를 누른 뒤에야 소리를 켠다.
 * - assets/audio 에 파일(engine, liftoff, stage, explosion, landing)이 있으면 그 파일을,
 *   없거나 읽지 못하면 코드로 만든 합성음을 쓴다. 소리가 없어도 게임은 그대로 동작한다.
 * - 엔진 소리는 계속 재생되며 크기·음색이 실제 추력 비율을 따라간다.
 */
import { listAssetFolder } from '../assets/assetDirectory.js';

const ENGINE_MAX_GAIN = 0.35; // 엔진 소리 최대 크기 (0~1)

/** @param {typeof import('../config/assetConfig.js').ASSET_CONFIG} assetConfig */
export function createSoundManager(assetConfig) {
  let ctx = null;
  let master = null;
  let muted = false;
  const buffers = new Map(); // 파일에서 읽은 소리
  let engine = null; // { gain, filter }
  let unlocked = false;

  /** 첫 사용자 입력에서 오디오를 켠다 */
  async function unlock() {
    if (unlocked) return;
    unlocked = true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return; // 오디오를 지원하지 않는 환경: 소리 없이 진행
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    await ctx.resume().catch(() => {});
    await loadFiles();
    startEngineLoop();
  }
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, unlock, { once: false, capture: true });
  }

  async function loadFiles() {
    const available = await listAssetFolder(assetConfig.audioFolder);
    await Promise.all(
      assetConfig.sounds.map(async (name) => {
        const ext = assetConfig.audioExtensions.find((e) => available.has(name + e));
        if (!ext) return;
        try {
          const data = await (await fetch(assetConfig.audioFolder + name + ext)).arrayBuffer();
          buffers.set(name, await ctx.decodeAudioData(data));
        } catch (error) {
          console.warn(`[ORBIT PILOT] 효과음 파일을 읽지 못해 합성음을 사용합니다: ${name}${ext}`, error);
        }
      }),
    );
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** 엔진 소리: 파일이 있으면 반복 재생, 없으면 걸러낸 잡음(우르릉 소리) */
  function startEngineLoop() {
    const source = ctx.createBufferSource();
    source.buffer = buffers.get('engine') ?? noiseBuffer(2);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(master);
    source.start();
    engine = { gain, filter, fromFile: buffers.has('engine') };
  }

  /** 짧은 합성음: 걸러낸 잡음 폭발음 */
  function noiseBurst({ duration, frequency, type = 'lowpass', volume = 0.8 }) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start();
  }

  /** 짧은 합성음: 음 높이가 있는 신호음 */
  function tone(frequency, start, duration, volume = 0.25) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function playFile(name) {
    const buffer = buffers.get(name);
    if (!buffer) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start();
    return true;
  }

  const synth = {
    liftoff: () => noiseBurst({ duration: 1.6, frequency: 180, volume: 0.6 }),
    stage: () => {
      noiseBurst({ duration: 0.25, frequency: 1800, type: 'bandpass', volume: 0.9 });
      tone(90, 0, 0.3, 0.3);
    },
    explosion: () => noiseBurst({ duration: 2.2, frequency: 420, volume: 1 }),
    landingSuccess: () => {
      tone(660, 0, 0.25);
      tone(880, 0.18, 0.4);
    },
  };

  return {
    /**
     * 시뮬레이션 사건에 맞는 소리를 낸다
     * @param {{type:string, result?:string}} event
     */
    play(event) {
      if (!ctx || muted) return;
      switch (event.type) {
        case 'liftoff':
          if (!playFile('liftoff')) synth.liftoff();
          break;
        case 'stage':
          if (!playFile('stage')) synth.stage();
          break;
        case 'parachute':
        case 'parachuteTorn':
          if (!playFile('stage')) synth.stage(); // 펼치는 소리는 단 분리음과 같은 "펑" 소리
          break;
        case 'explosion':
          if (!playFile('explosion')) synth.explosion();
          break;
        case 'landing':
          if (event.result === 'success' && !playFile('landing')) synth.landingSuccess();
          break;
        case 'docked':
          if (!playFile('landing')) synth.landingSuccess();
          break;
        default:
      }
    },
    /**
     * 매 프레임: 엔진 소리 크기·음색
     * @param {number} thrustFraction 실제 추력 / 최대 추력 (0~1)
     */
    updateEngine(thrustFraction) {
      if (!ctx || !engine) return;
      const now = ctx.currentTime;
      engine.gain.gain.setTargetAtTime(ENGINE_MAX_GAIN * thrustFraction, now, 0.08);
      if (!engine.fromFile) engine.filter.frequency.setTargetAtTime(250 + 900 * thrustFraction, now, 0.1);
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 1;
    },
    isMuted: () => muted,
    isUnlocked: () => Boolean(ctx),
    loadedFiles: () => [...buffers.keys()],
  };
}

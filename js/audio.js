import { gainAt, hasKf } from './kf.js';
import { extractAacTrack, trimStart } from './audioextract.js';
// Motor de audio: decodifica el audio de vídeos/audios y programa la reproducción mezclada.
// limitador de techo: protege de saturaciones sin aplastar la dinámica
function setLimiter(n) {
  n.threshold.value = -1.5; n.knee.value = 0; n.ratio.value = 20; n.attack.value = 0.003; n.release.value = 0.1;
}
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sources = [];
  }

  init() {
    // iPad/iPhone: sin esto el interruptor de silencio apaga todo el sonido de la web
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* */ }
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    setLimiter(this.comp);
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);
    this.exportDest = this.ctx.createMediaStreamDestination();
    this.comp.connect(this.exportDest);
    return this.ctx;
  }

  // Desbloqueo para Safari: hay que «tocar» el audio dentro de un gesto del usuario
  unlock() {
    const ctx = this.init();
    if (!ctx) return;
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) { /* */ }
    if (!this._tag) {
      // un <audio> silencioso cambia la sesión de iOS a «reproducción» (suena aunque esté en silencio)
      const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';
      this._tag = new Audio(wav);
      this._tag.setAttribute('playsinline', '');
      this._tag.loop = false;
    }
    this._tag.play().catch(() => {});
    this.unlocked = ctx.state === 'running';
  }

  async decode(media) {
    const ctx = this.init();
    if (!ctx || media.kind === 'image') return null;
    media.audioFallback = false;
    let buf = null;
    const name = (media.name || '').toLowerCase();
    const type = media.blob.type || '';
    const isMp4 = /\.(mp4|mov|m4v|m4a|3gp)$/.test(name) || /mp4|quicktime|m4a|3gpp/.test(type);
    // 1) MP4/MOV (iPhone, iPad…): se saca solo la pista de sonido. Rápido y gasta poca memoria.
    if (isMp4) {
      try {
        const r = await extractAacTrack(media.blob);
        if (r && r.noAudio) { media.buffer = null; media.peaks = null; return null; }
        if (r && r.adts) buf = trimStart(ctx, await ctx.decodeAudioData(r.adts), r.skip);
      } catch (e) { console.warn('Extracción AAC falló', e); buf = null; }
    }
    // 2) Decodificación directa del archivo completo
    if (!buf && media.blob.size <= 450 * 1024 * 1024) {
      try { buf = await ctx.decodeAudioData(await media.blob.arrayBuffer()); } catch (e) { buf = null; }
    }
    if (!buf) {
      media.buffer = null;
      // si no se pudo separar el sonido, el vídeo sonará directamente (sin mezclar)
      media.audioFallback = media.kind === 'video';
      return null;
    }
    media.buffer = buf;
    // picos para dibujar la onda (40 por segundo)
    const ch = buf.getChannelData(0);
    const n = Math.max(1, Math.ceil(buf.duration * 40));
    const step = Math.max(1, Math.floor(ch.length / n));
    const peaks = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const s0 = i * step, e = Math.min(ch.length, s0 + step);
      for (let jj = s0; jj < e; jj += Math.max(1, Math.floor(step / 24))) { const v = Math.abs(ch[jj]); if (v > m) m = v; }
      peaks[i] = m;
    }
    media.peaks = peaks;
    return buf;
  }

  stop() {
    for (const s of this.sources) { try { s.src.stop(); } catch (e) { /* ya parado */ } try { s.gain.disconnect(); } catch (e) { /* */ } }
    this.sources = [];
  }

  hasAudio(project, media) {
    return project.clips.some((c) => (c.type === 'audio' || (c.type === 'video' && !c.muted)) && media.get(c.media) && media.get(c.media).buffer);
  }

  // Mezcla completa sin reproducir (para exportar)
  async renderOffline(project, media, dur, sr = 48000) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const len = Math.max(1, Math.ceil(dur * sr));
    const ctx = new OAC(2, len, sr);
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    setLimiter(comp);
    master.connect(comp); comp.connect(ctx.destination);
    this._scheduleOn(ctx, master, project, media, 0, 0);
    return await ctx.startRendering();
  }

  // ¿hay voz en el instante T del proyecto? (clips marcados como «voz»; mira 0,25 s hacia delante para bajar la música a tiempo)
  voiceAt(project, media, T) {
    let a = 0;
    for (const v of project.clips) {
      if (v.role !== 'voice' || (v.type !== 'audio' && !(v.type === 'video' && !v.muted))) continue;
      const lt = T - v.start;
      if (lt < -0.3 || lt > v.dur) continue;
      const m = media.get(v.media);
      if (!m || !m.peaks) continue;
      const t0 = v.in + Math.max(0, lt) * v.speed;
      const i0 = Math.floor(t0 * 40), i1 = Math.floor((t0 + 0.25 * v.speed) * 40);
      let mx = 0;
      for (let i = i0; i <= i1; i++) { const p = m.peaks[i] || 0; if (p > mx) mx = p; }
      a = Math.max(a, mx * Math.min(1, gainAt(v, Math.max(0, Math.min(v.dur, lt))) + 0.0001));
    }
    return a;
  }

  _scheduleOn(ctx, dest, project, media, fromTime, base, list) {
    for (const c of project.clips) {
      if (c.type !== 'audio' && !(c.type === 'video' && !c.muted)) continue;
      if (c.start + c.dur <= fromTime) continue;
      const m = media.get(c.media);
      if (!m || !m.buffer) continue;
      const off = Math.max(0, fromTime - c.start);
      const D = c.dur - off;
      const srcOff = c.in + off * c.speed;
      if (srcOff >= m.buffer.duration || D <= 0.01) continue;
      const when = base + Math.max(0, c.start - fromTime);
      const src = ctx.createBufferSource();
      src.buffer = m.buffer;
      src.playbackRate.value = c.speed;
      const gain = ctx.createGain();
      // micro-fundidos de 8 ms al empezar y acabar: evitan los chasquidos en cada corte
      const ramp = Math.min(0.008, D / 4);
      const duck = !!(c.duck && c.duck.on && c.role !== 'voice');
      const dbG = duck ? Math.pow(10, (c.duck.db == null ? -14 : c.duck.db) / 20) : 1;
      let dg = 1;
      const duckStep = (lt, dt) => {
        // la música baja rápido (0,12 s) cuando entra la voz y sube despacio (0,5 s) cuando se calla
        const tgt = this.voiceAt(project, media, c.start + lt) > 0.05 ? dbG : 1;
        dg += (tgt - dg) * (1 - Math.exp(-dt / (tgt < dg ? 0.12 : 0.5)));
        return dg;
      };
      if (duck) dg = this.voiceAt(project, media, c.start + off) > 0.05 ? dbG : 1;
      if (hasKf(c, 'volume') || c.afadeIn > 0 || c.afadeOut > 0 || duck) {
        // curva de volumen (keyframes + fundidos) muestreada a 25 por segundo
        const step = 0.04;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(gainAt(c, off) * dg, when + ramp);
        for (let lt = off + step; lt < c.dur - ramp; lt += step) gain.gain.linearRampToValueAtTime(gainAt(c, lt) * (duck ? duckStep(lt, step) : 1), when + (lt - off));
        gain.gain.linearRampToValueAtTime(gainAt(c, c.dur - ramp) * dg, when + D - ramp);
        gain.gain.linearRampToValueAtTime(0, when + D);
      } else {
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(c.volume, when + ramp);
        gain.gain.setValueAtTime(c.volume, when + D - ramp);
        gain.gain.linearRampToValueAtTime(0, when + D);
      }
      src.connect(gain); gain.connect(dest);
      src.start(when, srcOff, Math.min(D * c.speed, m.buffer.duration - srcOff));
      if (list) list.push({ src, gain });
    }
  }

  // Programa todos los clips con audio desde el instante fromTime
  schedule(project, media, fromTime) {
    const ctx = this.init();
    if (!ctx) return;
    this.stop();
    this._scheduleOn(ctx, this.master, project, media, fromTime, ctx.currentTime + 0.06, this.sources);
  }
}

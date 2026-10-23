// Motor de audio: decodifica el audio de vídeos/audios y programa la reproducción mezclada.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sources = [];
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -6; this.comp.ratio.value = 6; this.comp.knee.value = 12;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);
    this.exportDest = this.ctx.createMediaStreamDestination();
    this.comp.connect(this.exportDest);
    return this.ctx;
  }

  async decode(media) {
    const ctx = this.init();
    if (!ctx || media.kind === 'image') return null;
    if (media.blob.size > 400 * 1024 * 1024) return null;
    try {
      const ab = await media.blob.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab);
      media.buffer = buf;
      // picos para dibujar la onda (40 por segundo)
      const ch = buf.getChannelData(0);
      const n = Math.max(1, Math.ceil(buf.duration * 40));
      const step = Math.max(1, Math.floor(ch.length / n));
      const peaks = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let m = 0;
        const s = i * step, e = Math.min(ch.length, s + step);
        for (let j = s; j < e; j += Math.max(1, Math.floor(step / 24))) { const v = Math.abs(ch[j]); if (v > m) m = v; }
        peaks[i] = m;
      }
      media.peaks = peaks;
      return buf;
    } catch (e) {
      media.buffer = null;
      return null;
    }
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
    comp.threshold.value = -6; comp.ratio.value = 6; comp.knee.value = 12;
    master.connect(comp); comp.connect(ctx.destination);
    this._scheduleOn(ctx, master, project, media, 0, 0);
    return await ctx.startRendering();
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
      const vol = c.volume;
      const fi = c.afadeIn || 0, fo = c.afadeOut || 0;
      if (fi > 0 && off < fi) {
        gain.gain.setValueAtTime(vol * (off / fi), when);
        gain.gain.linearRampToValueAtTime(vol, when + (fi - off));
      } else gain.gain.setValueAtTime(vol, when);
      if (fo > 0) {
        const tStart = when + Math.max(0, D - fo);
        gain.gain.setValueAtTime(vol, Math.max(when, tStart));
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

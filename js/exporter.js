// Exportación.
// 1) Preferida: fotograma a fotograma con WebCodecs + MP4 propio (calidad exacta, sin saltos aunque el equipo vaya lento).
// 2) Alternativa: grabar el lienzo en tiempo real con MediaRecorder.
import { Mp4Mux } from './mp4mux.js';

export async function offlineConfig(w, h, fps, bitrate, wantAudio) {
  if (!window.VideoEncoder || !window.VideoFrame) return null;
  let vcfg = null;
  // nivel H.264 según macrobloques por segundo (1080x1920 a 60 fps o 4K necesitan niveles altos)
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
  const lv = mbs <= 245760 ? '28' : mbs <= 522240 ? '2a' : mbs <= 983040 ? '33' : '34';
  for (const codec of ['avc1.6400' + lv, 'avc1.4d00' + lv, 'avc1.640033', 'avc1.640034']) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) { vcfg = cfg; break; } } catch (e) { /* */ }
  }
  if (!vcfg) return null;
  let acfg = null;
  if (wantAudio) {
    if (!window.AudioEncoder || !window.AudioData) return null;
    for (const [codec, kind] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
      try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) { acfg = { cfg, kind }; break; } } catch (e) { /* */ }
    }
    if (!acfg) return null;
  }
  return { vcfg, acfg };
}

// renderFrame(t) debe dejar dibujado el fotograma en `canvas`
export async function exportOffline({ canvas, w, h, fps, dur, cfg, renderFrame, audioBuffer, onProgress, isCancelled }) {
  const mux = new Mp4Mux({
    video: { width: w, height: h, fps },
    audio: cfg.acfg ? { codec: cfg.acfg.kind, sampleRate: 48000, channels: 2, bitrate: 192000 } : null,
  });
  let err = null;
  const venc = new VideoEncoder({ output: (c, m) => mux.addVideo(c, m), error: (e) => (err = e) });
  venc.configure(cfg.vcfg);
  const N = Math.max(1, Math.round(dur * fps));
  const fdur = Math.round(1e6 / fps);
  for (let i = 0; i < N; i++) {
    if (isCancelled()) { try { venc.close(); } catch (e) { /* */ } return null; }
    if (err) throw err;
    await renderFrame(i / fps);
    const frame = new VideoFrame(canvas, { timestamp: i * fdur, duration: fdur });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
    if (i % 3 === 0) { onProgress(((i + 1) / N) * (audioBuffer ? 0.94 : 1)); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush();
  venc.close();
  if (err) throw err;
  if (audioBuffer && cfg.acfg) {
    const aenc = new AudioEncoder({ output: (c, m) => mux.addAudio(c, m), error: (e) => (err = e) });
    aenc.configure(cfg.acfg.cfg);
    const sr = audioBuffer.sampleRate, L = audioBuffer.length;
    const ch0 = audioBuffer.getChannelData(0), ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    const block = 4800;
    for (let o = 0; o < L; o += block) {
      const n = Math.min(block, L - o);
      const data = new Float32Array(n * 2);
      data.set(ch0.subarray(o, o + n), 0);
      data.set(ch1.subarray(o, o + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / sr) * 1e6), data });
      aenc.encode(ad);
      ad.close();
      if (aenc.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 2));
    }
    await aenc.flush();
    aenc.close();
    if (err) throw err;
  }
  onProgress(1);
  return mux.finalize();
}
export function pickMime() {
  const list = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [m, ext] of list) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return { mime: m, ext }; } catch (e) { /* */ }
  }
  return null;
}

export function startRecorder(canvas, audioStream, { bitrate = 10_000_000, fps = 30 } = {}) {
  const pick = pickMime();
  if (!pick) throw new Error('Este navegador no puede grabar vídeo.');
  const vstream = canvas.captureStream(fps);
  const tracks = [...vstream.getVideoTracks()];
  if (audioStream) tracks.push(...audioStream.getAudioTracks());
  const stream = new MediaStream(tracks);
  const rec = new MediaRecorder(stream, { mimeType: pick.mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(500);
  return {
    mime: pick.mime, ext: pick.ext,
    stop: () => new Promise((res) => {
      rec.onstop = () => res(new Blob(chunks, { type: pick.mime.split(';')[0] }));
      try { rec.requestData(); } catch (e) { /* */ }
      rec.stop();
    }),
  };
}

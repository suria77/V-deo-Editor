// Subtítulos automáticos: Whisper (transformers.js) dentro del navegador + editor de revisión + importar SRT.
import { state, bus, commit, makeTextClip, getClip, removeClip, select, projectDuration } from './state.js';
import { h, toast, openModal, closeModal, fmtTime } from './ui.js';

const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm';

const MODELS = [
  { id: 'tiny', n: 'Rápido', d: 'Más ligero (~40 MB). Menos preciso.' },
  { id: 'base', n: 'Equilibrado', d: 'Buen punto medio (~80 MB).' },
  { id: 'small', n: 'Preciso', d: 'El más exacto (~250 MB). Tarda más y necesita buena conexión la primera vez.' },
];
const LANGS = [
  ['spanish', 'Español'], ['english', 'Inglés'], ['catalan', 'Catalán'], ['portuguese', 'Portugués'],
  ['french', 'Francés'], ['italian', 'Italiano'], ['german', 'Alemán'], ['auto', 'Detectar solo'],
];

export const SUB_STYLES = [
  { id: 'kar', n: 'Karaoke amarillo', p: { font: 'Montserrat', weight: 900, size: 0.052, upper: true, color: '#ffffff', stroke: { w: 0.009, color: '#000000' }, shadow: { blur: 0.3, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 } }, karaoke: '#ffd23f' },
  { id: 'cls', n: 'Blanco clásico', p: { font: 'Poppins', weight: 700, size: 0.046, upper: false, color: '#ffffff', stroke: { w: 0.006, color: '#000000' }, shadow: { blur: 0.4, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 } }, karaoke: null },
  { id: 'box', n: 'Caja negra', p: { font: 'Sora', weight: 700, size: 0.044, upper: false, color: '#ffffff', stroke: { w: 0, color: '#000000' }, shadow: { blur: 0, color: '#000000' }, bg: { on: true, color: '#000000', alpha: 0.62 } }, karaoke: '#ffd23f' },
  { id: 'neon', n: 'Neón rosa', p: { font: 'Bebas Neue', weight: 400, size: 0.075, upper: true, color: '#ffffff', stroke: { w: 0, color: '#000000' }, shadow: { blur: 1.4, color: '#ff2fa0' }, bg: { on: false, color: '#000000', alpha: 0.5 } }, karaoke: '#ff6ec7' },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isSub = (c) => c.type === 'text' && c.sub;
export const subClips = () => state.project.clips.filter(isSub).sort((a, b) => a.start - b.start);

// ------------------------------------------------------------------ audio
function audioSources() {
  return state.project.clips.filter((c) => {
    if (!c.media) return false;
    const m = state.media.get(c.media);
    return c.type === 'audio' || c.type === 'video' || (m && (m.kind === 'video' || m.kind === 'audio'));
  });
}

async function mixMono16k(app, ids) {
  // se escucha la voz tal cual (aunque el clip esté silenciado o con keyframes de volumen)
  const clips = state.project.clips.filter((c) => ids.has(c.id)).map((c) => ({ ...c, muted: false, volume: 1, kf: null, afadeIn: 0, afadeOut: 0 }));
  const sub = { ...state.project, clips };
  const end = Math.max(...clips.map((c) => c.start + c.dur));
  const buf = await app.audio.renderOffline(sub, state.media, end, 16000);
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const out = new Float32Array(buf.length);
  let peak = 0;
  for (let i = 0; i < out.length; i++) { const v = b ? (a[i] + b[i]) / 2 : a[i]; out[i] = v; const m = Math.abs(v); if (m > peak) peak = m; }
  // Normalizar: la voz baja se reconoce peor
  if (peak > 0.002) { const g = Math.min(8, 0.95 / peak); if (g > 1.05) for (let i = 0; i < out.length; i++) out[i] *= g; }
  return out;
}

// ------------------------------------------------------------------ utilidades
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ISO = { spanish: 'es', english: 'en', catalan: 'ca', portuguese: 'pt', french: 'fr', italian: 'it', german: 'de' };
const KEY_LS = 'atelier.elevenlabsKey';
const getKey = () => { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } };
const saveKey = (k) => { try { if (k) localStorage.setItem(KEY_LS, k); else localStorage.removeItem(KEY_LS); } catch (e) { /* */ } };
const yieldUI = () => new Promise((r) => setTimeout(r, 30));

function cleanWords(out, total) {
  out = out.filter((w) => w.t && !/^[\[(♪*].*[\])♪*]$/.test(w.t));
  for (let i = 0; i < out.length; i++) {
    const nx = out[i + 1];
    if (out[i].e == null || out[i].e < out[i].s) out[i].e = Math.min(total, out[i].s + 0.4);
    if (nx && out[i].e > nx.s) out[i].e = Math.max(out[i].s + 0.05, nx.s);
    if (out[i].e - out[i].s > 2.5) out[i].e = out[i].s + 1.2;
  }
  return out;
}

// WAV 16 bits mono (para enviar a ElevenLabs)
function toWav(samples, rate = 16000) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}

// ------------------------------------------------------------------ Motor 1: ElevenLabs (máxima precisión)
async function transcribeEleven(audio, lang, key, onProgress) {
  const wav = toWav(audio);
  const q = lang && lang !== 'auto' ? `?lang=${ISO[lang] || ''}` : '';
  onProgress({ text: 'Enviando el audio a ElevenLabs…', pct: 0.2 });
  let res = null, err = '';
  // a) a través de la función de Cloudflare de la propia app; b) directo a ElevenLabs
  try {
    res = await fetch('/api/transcribe' + q, { method: 'POST', headers: { 'x-el-key': key, 'content-type': 'audio/wav' }, body: wav });
    if (res.status === 404 || res.status === 405) res = null;
  } catch (e) { res = null; }
  if (!res) {
    const fd = new FormData();
    fd.append('model_id', 'scribe_v2');
    fd.append('file', wav, 'audio.wav');
    fd.append('timestamps_granularity', 'word');
    fd.append('tag_audio_events', 'false');
    if (ISO[lang]) fd.append('language_code', ISO[lang]);
    res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  }
  onProgress({ text: 'ElevenLabs está escribiendo…', pct: 0.8 });
  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch (e) { /* */ }
  if (!res.ok) {
    const d = data && data.detail;
    err = (d && (d.message || d.status)) || (typeof d === 'string' ? d : '') || txt.slice(0, 160);
    if (res.status === 401) err = 'La clave de ElevenLabs no es válida o no tiene permiso de «Speech to Text».';
    throw new Error(err || 'Error ' + res.status);
  }
  const words = (data.words || []).filter((w) => w.type === 'word').map((w) => ({ t: (w.text || '').trim(), s: w.start, e: w.end }));
  return cleanWords(words, audio.length / 16000);
}

// ------------------------------------------------------------------ Motor 2: Whisper en el dispositivo
let asr = null, asrKey = '';

async function loadAsr(size, onProgress) {
  const T = await import(/* @vite-ignore */ TJS);
  // En iPad/iPhone se usa el procesador (más estable, menos memoria); en ordenador, la gráfica si existe
  const gpu = !!navigator.gpu && !IS_IOS;
  const tries = [];
  const ids = [`onnx-community/whisper-${size}_timestamped`, `Xenova/whisper-${size}`];
  for (const id of ids) {
    if (gpu) tries.push({ id, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
    tries.push({ id, device: 'wasm', dtype: 'q8' });
  }
  let lastErr;
  for (const t of tries) {
    const key = `${t.id}|${t.device}`;
    if (asr && asrKey === key) return asr;
    const files = new Map();
    try {
      onProgress({ text: 'Preparando el reconocimiento de voz…', pct: 0.05 });
      const p = await T.pipeline('automatic-speech-recognition', t.id, {
        device: t.device, dtype: t.dtype,
        progress_callback: (e) => {
          if (!e || !e.file) return;
          if (e.status === 'progress' && e.total) files.set(e.file, [e.loaded, e.total]);
          if (e.status === 'done') { const f = files.get(e.file); if (f) files.set(e.file, [f[1], f[1]]); }
          let l = 0, tt = 0;
          for (const [a, b] of files.values()) { l += a; tt += b; }
          if (tt > 0) onProgress({ text: `Descargando el modelo (solo la primera vez)… ${Math.round((l / tt) * 100)}%`, pct: 0.05 + 0.4 * (l / tt) });
        },
      });
      asr = p; asrKey = key;
      return p;
    } catch (e) { lastErr = e; console.warn('Modelo falló', t, e); }
  }
  throw lastErr || new Error('No se pudo cargar el modelo');
}

// corta el audio en trozos de ~25 s por los silencios (gasta mucha menos memoria)
function splitAudio(audio, rate = 16000, len = 25) {
  const out = [];
  let s = 0;
  const N = audio.length;
  while (s < N) {
    let e = Math.min(N, s + len * rate);
    if (e < N) {
      const from = e - 4 * rate, win = rate / 20;
      let best = e, bestE = Infinity;
      for (let p = from; p < e; p += win) {
        let en = 0;
        for (let k = p; k < p + win; k++) en += audio[k] * audio[k];
        if (en < bestE) { bestE = en; best = p + win / 2; }
      }
      e = Math.floor(best);
    }
    out.push([s, e]);
    s = e;
  }
  return out;
}

async function transcribeLocal(pipe, audio, lang, onProgress) {
  const total = audio.length / 16000;
  const parts = splitAudio(audio);
  const words = [];
  for (let i = 0; i < parts.length; i++) {
    const [a, b] = parts[i];
    onProgress({ text: `Escuchando y escribiendo… (${i + 1} de ${parts.length})`, pct: 0.5 + 0.48 * (i / parts.length) });
    await yieldUI();
    const opts = { return_timestamps: 'word', task: 'transcribe' };
    if (lang && lang !== 'auto') opts.language = lang;
    const res = await pipe(audio.subarray(a, b), opts);
    const off = a / 16000;
    for (const ch of res.chunks || []) {
      const [s, e] = ch.timestamp || [];
      if (s == null) continue;
      words.push({ t: (ch.text || '').trim(), s: s + off, e: e == null ? null : e + off });
    }
  }
  return cleanWords(words, total);
}

// ------------------------------------------------------------------ agrupar palabras en líneas
export function groupWords(words, { maxWords = 4, maxChars = 22 } = {}) {
  const lines = [];
  let cur = [];
  const flush = () => { if (cur.length) { lines.push(cur); cur = []; } };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], prev = cur[cur.length - 1];
    if (prev && w.s - prev.e > 0.6) flush();
    const chars = cur.reduce((n, x) => n + x.t.length + 1, 0) + w.t.length;
    if (cur.length && (cur.length >= maxWords || chars > maxChars)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.t) && cur.length >= 2) flush();
    else if (/[,;:]$/.test(w.t) && cur.length >= Math.max(2, maxWords - 1)) flush();
  }
  flush();
  return lines;
}

function buildClips(lines, style, position) {
  const made = [];
  lines.forEach((ln, i) => {
    const s = ln[0].s;
    const nextS = lines[i + 1] ? lines[i + 1][0].s : Infinity;
    let e = ln[ln.length - 1].e + 0.12;
    e = Math.min(e, nextS - 0.01);
    if (nextS - ln[ln.length - 1].e < 0.35) e = Math.max(e, nextS - 0.01); // sin parpadeo entre líneas pegadas
    e = Math.max(e, s + 0.25);
    const c = makeTextClip(s, structuredClone(style.p));
    c.dur = e - s;
    c.text = ln.map((w) => w.t).join(' ');
    c.words = ln.map((w) => ({ t: w.t, s: Math.max(0, w.s - s), e: Math.max(0, w.e - s) }));
    c.sub = true;
    c.karaoke = style.karaoke ? { color: style.karaoke } : null;
    c.y = position;
    c.inAnim = { type: 'none', dur: 0.1 };
    c.outAnim = { type: 'none', dur: 0.1 };
    c.width = 0.86;
    made.push(c);
  });
  return made;
}

export function applyLines(lines, style, position, replace) {
  if (replace) for (const c of subClips()) removeClip(c.id);
  const made = buildClips(lines, style, position);
  for (const c of made) state.project.clips.push(c);
  bus.emit('change', { structural: true });
  commit();
  return made;
}

// ------------------------------------------------------------------ SRT
function parseSrt(txt) {
  const out = [];
  const toS = (a) => { const m = a.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +('0.' + m[4]) : null; };
  for (const blk of txt.replace(/\r/g, '').split(/\n\s*\n/)) {
    const ls = blk.split('\n').filter((l) => l.trim());
    const i = ls.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = ls[i].split('-->');
    const s = toS(a), e = toS(b);
    const text = ls.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (s == null || e == null || !text) continue;
    out.push({ s, e, text });
  }
  return out;
}

function srtToLines(items) {
  // Reparte el tiempo de cada bloque entre sus palabras (proporcional a su longitud)
  return items.map((it) => {
    const toks = it.text.split(/\s+/).filter(Boolean);
    const tot = toks.reduce((n, t) => n + t.length + 1, 0);
    let acc = it.s;
    return toks.map((t) => { const d = ((t.length + 1) / tot) * (it.e - it.s); const w = { t, s: acc, e: acc + d }; acc += d; return w; });
  });
}

export function exportSrt() {
  const f = (t) => { const ms = Math.round(t * 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  return subClips().map((c, i) => `${i + 1}\n${f(c.start)} --> ${f(c.start + c.dur)}\n${c.text}\n`).join('\n');
}

// ------------------------------------------------------------------ edición de texto manteniendo tiempos
export function retext(c, text) {
  c.text = text;
  const toks = text.split(/\s+/).filter(Boolean);
  if (!c.words || !c.words.length) return;
  if (toks.length === c.words.length) { c.words.forEach((w, i) => (w.t = toks[i])); return; }
  // distinto número de palabras: reparte el tiempo total de forma proporcional
  const s0 = c.words[0].s, e0 = c.words[c.words.length - 1].e;
  const tot = toks.reduce((n, t) => n + t.length + 1, 0);
  let acc = s0;
  c.words = toks.map((t) => { const d = ((t.length + 1) / tot) * (e0 - s0); const w = { t, s: acc, e: acc + d }; acc += d; return w; });
}

// ------------------------------------------------------------------ UI
export async function openSubtitles(app) {
  const all = audioSources().filter((c) => state.media.get(c.media));
  if (!all.length) {
    openModal([h('h2', {}, '💬 Subtítulos automáticos'), h('p', { class: 'sub' }, 'No hay ningún vídeo ni audio en la línea de tiempo. Añade un vídeo con voz o una locución y vuelve a intentarlo.'), h('button', { class: 'btn block', onclick: closeModal }, 'Entendido')]);
    return;
  }
  // si algún vídeo aún no tiene el sonido preparado, se intenta leer ahora
  const pending = [...new Set(all.map((c) => state.media.get(c.media)).filter((m) => !m.buffer))];
  if (pending.length) {
    openModal([h('h2', {}, '💬 Subtítulos automáticos'), h('p', { class: 'sub' }, 'Preparando el sonido de tus vídeos…')], { dismissable: false });
    for (const m of pending) { try { await app.audio.decode(m); } catch (e) { /* */ } }
    closeModal();
  }
  const srcs = all.filter((c) => state.media.get(c.media).buffer);
  if (!srcs.length) {
    openModal([h('h2', {}, '💬 Subtítulos automáticos'), h('p', { class: 'sub' }, 'No he podido leer el sonido de los vídeos que hay en la línea de tiempo. Puede que el vídeo no tenga audio o que esté en un formato que el navegador no sabe abrir. Prueba a exportarlo desde Fotos como MP4 o a grabar la voz con «Grabar voz».'), h('button', { class: 'btn block', onclick: closeModal }, 'Entendido')]);
    return;
  }
  const cfg = { engine: 'el', model: IS_IOS ? 'tiny' : 'base', lang: 'spanish', style: 'kar', words: 4, pos: 0.55, replace: true };
  const chosen = new Set(srcs.map((c) => c.id));
  const exist = subClips().length;

  const body = h('div', {});
  const pill = (items, key, fmtLabel) => {
    const row = h('div', { class: 'chips' });
    items.forEach(([v, lab]) => row.append(h('button', { class: cfg[key] === v ? 'on' : '', onclick: (e) => { cfg[key] = v; [...row.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, lab)));
    return row;
  };
  body.append(
    h('h2', {}, '💬 Subtítulos automáticos'),
    h('p', { class: 'sub' }, 'Con ElevenLabs solo se envía el sonido (no el vídeo) y las palabras quedan sincronizadas al milisegundo. «En el dispositivo» es gratis pero menos preciso y más lento.'),
    h('h4', {}, 'Qué audio escuchar'),
  );
  const list = h('div', { class: 'src-list' });
  for (const c of srcs) {
    const m = state.media.get(c.media);
    const cb = h('input', { type: 'checkbox' });
    cb.checked = chosen.has(c.id);
    cb.onchange = () => (cb.checked ? chosen.add(c.id) : chosen.delete(c.id));
    list.append(h('label', { class: 'src-row' }, cb, h('span', {}, `${c.type === 'audio' ? '🎵' : '🎬'} ${m.name || 'Clip'} · ${fmtTime(c.start)}–${fmtTime(c.start + c.dur)}`)));
  }
  body.append(list, h('p', { class: 'hint' }, 'Desmarca la música: así el reconocimiento acierta mucho más.'));
  body.append(h('h4', {}, 'Idioma hablado'), pill(LANGS, 'lang'));
  // Motor
  const keyIn = h('input', { type: 'text', placeholder: 'Pega aquí tu clave de ElevenLabs (sk_…)', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  keyIn.value = getKey();
  const elBox = h('div', {},
    keyIn,
    h('p', { class: 'hint', style: 'margin-top:8px' }, 'La clave se guarda solo en este dispositivo. La encuentras en elevenlabs.io → tu perfil → «API Keys» (con permiso de «Speech to Text»). Gasta minutos de transcripción de tu plan de ElevenLabs.'));
  const localModels = MODELS.filter((m) => !(IS_IOS && m.id === 'small'));
  const localBox = h('div', {},
    pill(localModels.map((m) => [m.id, m.n]), 'model'),
    h('p', { class: 'hint' }, IS_IOS ? 'En iPad usa «Rápido» o «Equilibrado»: los modelos grandes pueden llenar la memoria y cerrar la página. Es menos preciso que ElevenLabs.' : 'Rápido ≈ tiny · Equilibrado ≈ base · Preciso ≈ small. Es menos preciso que ElevenLabs.'));
  const showEngine = () => { elBox.hidden = cfg.engine !== 'el'; localBox.hidden = cfg.engine !== 'local'; };
  const engRow = h('div', { class: 'chips' });
  [['el', '🎯 ElevenLabs (máxima precisión)'], ['local', '📱 En el dispositivo (gratis)']].forEach(([v, lab]) => {
    engRow.append(h('button', { class: cfg.engine === v ? 'on' : '', onclick: (e) => { cfg.engine = v; [...engRow.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); showEngine(); } }, lab));
  });
  engRow.style.gridTemplateColumns = '1fr 1fr';
  body.append(h('h4', {}, 'Cómo reconocer la voz'), engRow, elBox, localBox);
  showEngine();
  body.append(h('h4', {}, 'Estilo'), pill(SUB_STYLES.map((s) => [s.id, s.n]), 'style'));
  body.append(h('h4', {}, 'Palabras por línea'), pill([[2, '2'], [3, '3'], [4, '4'], [6, '6']], 'words'));
  body.append(h('h4', {}, 'Posición'), pill([[0.55, 'Abajo'], [0, 'Centro'], [-0.5, 'Arriba']], 'pos'));
  if (exist) {
    const cb = h('input', { type: 'checkbox' }); cb.checked = true; cb.onchange = () => (cfg.replace = cb.checked);
    body.append(h('label', { class: 'src-row', style: 'margin-top:10px' }, cb, h('span', {}, `Reemplazar los ${exist} subtítulos que ya hay`)));
  }
  const status = h('div', { class: 'sub-status', hidden: true });
  const bar = h('div', { class: 'sub-bar' }, h('i', {}));
  status.append(h('p', {}), bar);
  const go = h('button', { class: 'btn gold block', style: 'margin-top:16px' }, '✨ Crear subtítulos');
  const cancel = h('button', { class: 'btn block ghost', onclick: closeModal }, 'Cancelar');
  go.onclick = async () => {
    if (!chosen.size) { toast('Marca al menos un audio'); return; }
    go.disabled = true; cancel.hidden = true; status.hidden = false;
    const msg = status.firstChild, fill = bar.firstChild;
    const set = (t, p) => { msg.textContent = t; fill.style.width = Math.round((p ?? 0) * 100) + '%'; };
    try {
      app.pause && app.pause();
      if (cfg.engine === 'el') {
        const k = keyIn.value.trim();
        if (!k) { set('Pega primero tu clave de ElevenLabs (o elige «En el dispositivo»).', 0); go.disabled = false; cancel.hidden = false; return; }
        saveKey(k);
      }
      set('Preparando el audio…', 0.02);
      const audio = await mixMono16k(app, chosen);
      const prog = (e) => set(e.text, e.pct);
      let words;
      if (cfg.engine === 'el') words = await transcribeEleven(audio, cfg.lang, keyIn.value.trim(), prog);
      else {
        const pipe = await loadAsr(cfg.model, prog);
        words = await transcribeLocal(pipe, audio, cfg.lang, prog);
      }
      if (!words.length) { set('No se ha detectado voz.', 0); go.disabled = false; cancel.hidden = false; return; }
      const style = SUB_STYLES.find((s) => s.id === cfg.style);
      const lines = groupWords(words, { maxWords: cfg.words, maxChars: cfg.words * 7 });
      const made = applyLines(lines, style, cfg.pos, cfg.replace);
      closeModal();
      toast(`${made.length} subtítulos creados ✓`);
      openSubEditor(app);
    } catch (err) {
      console.error(err);
      set('No se pudo completar: ' + (err && err.message ? err.message : err) + (cfg.engine === 'el' ? '' : '. Comprueba tu conexión (la primera vez descarga el modelo) y vuelve a intentarlo.'), 0);
      go.disabled = false; cancel.hidden = false;
    }
  };
  body.append(status, go, cancel);
  openModal(body, { dismissable: false });
}

export function openSubEditor(app) {
  const render = () => {
    const subs = subClips();
    const body = h('div', {});
    body.append(h('h2', {}, `💬 Subtítulos (${subs.length})`), h('p', { class: 'sub' }, 'Corrige lo que haga falta. ▶ salta a ese momento. Los tiempos de cada palabra se conservan.'));
    if (!subs.length) body.append(h('p', { class: 'hint' }, 'Aún no hay subtítulos. Créalos con «Subtítulos automáticos» o importa un archivo .srt.'));
    const list = h('div', { class: 'sub-list' });
    for (const c of subs) {
      const ta = h('textarea', { rows: 2 });
      ta.value = c.text;
      ta.onchange = () => { retext(c, ta.value.trim()); bus.emit('change', { structural: false }); commit(); };
      const row = h('div', { class: 'sub-row' },
        h('div', { class: 'sub-t' }, h('b', {}, fmtTime(c.start)), h('button', { class: 'mini', title: 'Ir aquí', onclick: () => { app.pause && app.pause(); app.seek(c.start + 0.01); select(c.id); } }, '▶')),
        ta,
        h('button', { class: 'mini danger', title: 'Borrar', onclick: () => { removeClip(c.id); commit(); render(); } }, '🗑'),
      );
      list.append(row);
    }
    body.append(list);
    const acts = h('div', { class: 'sub-acts' },
      h('button', { class: 'btn', onclick: () => { closeModal(); openSubtitles(app); } }, '✨ Crear de nuevo'),
      h('button', { class: 'btn', onclick: () => pickSrt(app, render) }, '📄 Importar .srt'),
      subs.length ? h('button', { class: 'btn', onclick: downloadSrt }, '⬇ Guardar .srt') : '',
      subs.length ? h('button', { class: 'btn danger', onclick: () => { for (const c of subClips()) removeClip(c.id); commit(); render(); } }, 'Borrar todos') : '',
    );
    body.append(acts, h('button', { class: 'btn gold block', style: 'margin-top:12px', onclick: closeModal }, 'Listo'));
    openModal(body);
  };
  render();
}

function downloadSrt() {
  const blob = new Blob([exportSrt()], { type: 'text/plain' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'subtitulos.srt' });
  document.body.append(a); a.click(); a.remove();
}

function pickSrt(app, after) {
  const inp = h('input', { type: 'file', accept: '.srt,text/plain' });
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    const items = parseSrt(await f.text());
    if (!items.length) { toast('No he podido leer ese archivo .srt'); return; }
    for (const c of subClips()) removeClip(c.id);
    applyLines(srtToLines(items), SUB_STYLES[0], 0.55, false);
    toast(`${items.length} subtítulos importados ✓`);
    after();
  };
  inp.click();
}

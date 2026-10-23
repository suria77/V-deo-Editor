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
  return state.project.clips.filter((c) => c.type === 'audio' || (c.type === 'video' && !c.muted));
}

async function mixMono16k(app, ids) {
  const clips = state.project.clips.filter((c) => ids.has(c.id));
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

// ------------------------------------------------------------------ Whisper
let asr = null, asrKey = '';

async function loadAsr(size, onProgress) {
  const T = await import(/* @vite-ignore */ TJS);
  const gpu = !!(navigator.gpu);
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
    try {
      onProgress({ status: 'load', text: `Preparando el modelo (${t.device === 'webgpu' ? 'gráficos' : 'procesador'})…` });
      const p = await T.pipeline('automatic-speech-recognition', t.id, {
        device: t.device, dtype: t.dtype,
        progress_callback: (e) => { if (e && e.status === 'progress' && e.total) onProgress({ status: 'dl', pct: e.loaded / e.total, file: e.file }); },
      });
      asr = p; asrKey = key;
      return p;
    } catch (e) { lastErr = e; console.warn('Modelo falló', t, e); }
  }
  throw lastErr || new Error('No se pudo cargar el modelo');
}

async function transcribe(pipe, audio, lang, onProgress) {
  const total = audio.length / 16000;
  const opts = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
  if (lang && lang !== 'auto') opts.language = lang;
  const nChunks = Math.max(1, Math.ceil(total / 20));
  let done = 0;
  opts.chunk_callback = () => { done++; onProgress({ status: 'run', pct: Math.min(0.97, done / nChunks) }); };
  const res = await pipe(audio, opts);
  const out = [];
  for (const ch of res.chunks || []) {
    const t = (ch.text || '').trim();
    if (!t || /^[\[(♪*].*[\])♪*]$/.test(t)) continue;
    let [s, e] = ch.timestamp || [];
    if (s == null) continue;
    if (e == null || e < s) e = Math.min(total, s + 0.4);
    out.push({ t, s, e });
  }
  // Corrige solapes y duraciones imposibles
  for (let i = 0; i < out.length; i++) {
    const nx = out[i + 1];
    if (nx && out[i].e > nx.s) out[i].e = Math.max(out[i].s + 0.05, nx.s);
    if (out[i].e - out[i].s > 2.5) out[i].e = out[i].s + 1.2;
  }
  return out;
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
export function openSubtitles(app) {
  const srcs = audioSources().filter((c) => state.media.get(c.media) && state.media.get(c.media).buffer);
  if (!srcs.length) {
    openModal([h('h2', {}, '💬 Subtítulos automáticos'), h('p', { class: 'sub' }, 'Primero añade a la línea de tiempo un vídeo con voz o una locución. Los subtítulos se crean a partir de ese audio.'), h('button', { class: 'btn block', onclick: closeModal }, 'Entendido')]);
    return;
  }
  const cfg = { model: 'base', lang: 'spanish', style: 'kar', words: 4, pos: 0.55, replace: true };
  const chosen = new Set(srcs.filter((c) => c.type === 'video' || c.lane === 'audio').map((c) => c.id));
  const exist = subClips().length;

  const body = h('div', {});
  const pill = (items, key, fmtLabel) => {
    const row = h('div', { class: 'chips' });
    items.forEach(([v, lab]) => row.append(h('button', { class: cfg[key] === v ? 'on' : '', onclick: (e) => { cfg[key] = v; [...row.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, lab)));
    return row;
  };
  body.append(
    h('h2', {}, '💬 Subtítulos automáticos'),
    h('p', { class: 'sub' }, 'La voz se convierte en texto en tu propio dispositivo (no se sube ningún vídeo). La primera vez descarga un modelo de reconocimiento.'),
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
  body.append(h('h4', {}, 'Precisión'), pill(MODELS.map((m) => [m.id, m.n]), 'model'), h('p', { class: 'hint' }, 'Rápido ≈ tiny · Equilibrado ≈ base · Preciso ≈ small. Cuanto más preciso, más tarda.'));
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
      set('Preparando el audio…', 0.02);
      const audio = await mixMono16k(app, chosen);
      const pipe = await loadAsr(cfg.model, (e) => {
        if (e.status === 'dl') set(`Descargando el modelo… ${Math.round(e.pct * 100)}%`, e.pct * 0.5);
        else set(e.text || 'Cargando…', 0.5);
      });
      set('Escuchando y escribiendo…', 0.55);
      const words = await transcribe(pipe, audio, cfg.lang, (e) => set('Escuchando y escribiendo…', 0.55 + e.pct * 0.43));
      if (!words.length) { set('No se ha detectado voz.', 0); go.disabled = false; cancel.hidden = false; return; }
      const style = SUB_STYLES.find((s) => s.id === cfg.style);
      const lines = groupWords(words, { maxWords: cfg.words, maxChars: cfg.words * 7 });
      const made = applyLines(lines, style, cfg.pos, cfg.replace);
      closeModal();
      toast(`${made.length} subtítulos creados ✓`);
      openSubEditor(app);
    } catch (err) {
      console.error(err);
      set('No se pudo completar: ' + (err && err.message ? err.message : err) + '. Comprueba tu conexión (la primera vez descarga el modelo) y vuelve a intentarlo.', 0);
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

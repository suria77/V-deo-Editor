// Arranque de la app: reproductor, importación, exportación, gestos sobre la imagen.
import {
  state, bus, commit, undo, redo, canUndo, canRedo, uid, select, toggleSel, selectedClip, selectedClips, selectIds, setSelectMode, getClip,
  projectDuration, makeVisualClip, makeAudioClip, makeTextClip, makeFxClip, addClip,
  removeClip, removeClips, duplicateClips, splitClips, setAspect, loadProject, resetHistory,
} from './state.js';
import { Renderer } from './renderer.js';
import { Overlay, textBounds } from './overlay.js';
import { AudioEngine } from './audio.js';
import { Timeline } from './timeline.js';
import { Panels } from './panels.js';
import { startRecorder, pickMime, offlineConfig, exportOffline } from './exporter.js';
import { saveProject, loadSaved, clearSaved } from './storage.js';
import { ASPECTS } from './presets.js';
import { h, fmtTime, toast, openModal, closeModal } from './ui.js';
import { openSubtitles, openSubEditor, subClips } from './subs.js';
import { icon } from './icons.js';
import { valueAt, setValue, gainAt, toggleAllKf, anyKfAt } from './kf.js';

const $ = (id) => document.getElementById(id);
const canvas = $('cv');

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  document.body.innerHTML = `<div style="padding:40px;font-size:20px;font-family:sans-serif">Este navegador no es compatible (necesita WebGL2). Prueba con Safari actualizado o Chrome.<br><small>${e.message}</small></div>`;
  throw e;
}
const overlay = new Overlay();
const audio = new AudioEngine();
const videoEls = new Map(); // clipId -> HTMLVideoElement
let dirty = true;
let exporting = null;
let previewStop = null;

// ---------- tamaño de previsualización ----------
function previewDims() {
  const { w, h: hh } = state.project;
  const s = Math.min(1, 960 / Math.max(w, hh));
  return { w: Math.round((w * s) / 2) * 2, h: Math.round((hh * s) / 2) * 2 };
}
function applyPreviewSize() {
  if (exporting) return;
  const d = previewDims();
  if (renderer.W !== d.w || renderer.H !== d.h) renderer.resize(d.w, d.h);
  fitCanvas();
  dirty = true;
}
function fitCanvas() {
  const wrap = $('canvasWrap');
  const W = wrap.clientWidth - 24, H = wrap.clientHeight - 24;
  const ar = state.project.w / state.project.h;
  let cw = W, ch = W / ar;
  if (ch > H) { ch = H; cw = H * ar; }
  canvas.style.width = Math.max(10, cw) + 'px';
  canvas.style.height = Math.max(10, ch) + 'px';
}
new ResizeObserver(fitCanvas).observe($('canvasWrap'));

// ---------- vídeos ocultos (uno por clip) ----------
function videoFor(c) {
  let v = videoEls.get(c.id);
  const m = state.media.get(c.media);
  if (!m) return null;
  if (v && v._src === m.url) return v;
  v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v.src = m.url; v._src = m.url;
  v.addEventListener('seeked', () => (dirty = true));
  v.addEventListener('loadeddata', () => (dirty = true));
  $('hiddenVideos').append(v);
  videoEls.set(c.id, v);
  return v;
}
function cleanupVideos() {
  for (const [id, v] of videoEls) {
    if (!getClip(id)) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); videoEls.delete(id); renderer.releaseClip(id); }
  }
}

// Vídeos cuyo sonido no se pudo extraer: suenan por el propio elemento <video>
function elementAudio(c, v, active, t) {
  const m = state.media.get(c.media);
  const want = !!(m && m.audioFallback && !m.buffer && !c.muted && active && state.playing && !v._blocked);
  if (want) {
    const vol = Math.max(0, Math.min(1, gainAt(c, t - c.start)));
    if (v.muted) v.muted = false;
    if (Math.abs(v.volume - vol) > 0.01) v.volume = vol;
  } else if (!v.muted) v.muted = true;
}

function syncVideos(t) {
  for (const c of state.project.clips) {
    if (c.type !== 'video') continue;
    const v = videoFor(c);
    if (!v) continue;
    const active = t >= c.start && t < c.start + c.dur;
    elementAudio(c, v, active, t);
    const target = c.in + (t - c.start) * c.speed;
    if (active) {
      const rate = Math.min(4, Math.max(0.25, c.speed));
      if (v.playbackRate !== rate) v.playbackRate = rate;
      if (state.playing) {
        if (v.paused) { if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target; v.play().catch(() => { if (!v.muted) { v._blocked = true; v.muted = true; v.play().catch(() => {}); } }); }
        else if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.02 && !v.seeking) v.currentTime = target;
      }
    } else {
      if (!v.paused) v.pause();
      // pre-carga del primer fotograma de los clips que vienen
      const soon = c.start - t;
      if (soon > 0 && soon < 2 && Math.abs(v.currentTime - c.in) > 0.05 && !v.seeking) v.currentTime = c.in;
    }
  }
}

// ---------- bucle de dibujo ----------
let playT0 = 0, playFrom = 0;
function loop(now) {
  if (state.playing) {
    const dur = projectDuration();
    let t = playFrom + (now - playT0) / 1000;
    const end = previewStop != null ? previewStop : dur;
    if (t >= end) {
      t = end;
      state.time = Math.min(t, Math.max(0, dur - 0.0001));
      pause();
      if (exporting) exporting.finish();
    } else state.time = t;
    bus.emit('time');
    dirty = true;
  }
  if (dirty && !offlineBusy) {
    dirty = false;
    syncVideos(state.time);
    renderer.render({ project: state.project, t: state.time, media: state.media, videoFor, overlay });
    if (exporting) exporting.progress(state.time / Math.max(0.01, projectDuration()));
    else updateSelBoxes();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Primer toque en cualquier sitio: desbloquea el audio (Safari)
const unlockOnce = () => { audio.unlock(); if (audio.unlocked) { window.removeEventListener('pointerdown', unlockOnce, true); window.removeEventListener('touchend', unlockOnce, true); } };
window.addEventListener('pointerdown', unlockOnce, true);
window.addEventListener('touchend', unlockOnce, true);

// ---------- reproducción ----------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* no disponible */ }
}

function play(from = state.time, stopAt = null) {
  const dur = projectDuration();
  if (dur <= 0) { toast('Añade primero algún vídeo, foto, texto o efecto'); return; }
  if (from >= dur - 0.05) from = 0;
  previewStop = stopAt;
  audio.unlock();
  // bendice los vídeos que suenan por sí mismos (Safari exige un toque para reproducir con sonido)
  for (const c of state.project.clips) {
    if (c.type !== 'video') continue;
    const m = state.media.get(c.media);
    if (!m || !m.audioFallback || c.muted) continue;
    const v = videoFor(c);
    if (v) v._blocked = false;
    if (v && v.paused && !(from >= c.start && from < c.start + c.dur)) { v.muted = false; v.play().then(() => { if (!(state.time >= c.start && state.time < c.start + c.dur)) v.pause(); }).catch(() => {}); }
  }
  state.time = from;
  playFrom = from;
  state.playing = true;
  syncVideos(from);
  audio.schedule(state.project, state.media, from);
  playT0 = performance.now() + 60;
  $('btnPlay').textContent = '❚❚';
  keepAwake(true);
}
function pause() {
  state.playing = false;
  previewStop = null;
  audio.stop();
  for (const v of videoEls.values()) if (!v.paused) v.pause();
  $('btnPlay').textContent = '▶';
  dirty = true;
  if (!exporting) keepAwake(false);
}
function seek(t, keepPlaying = false) {
  t = Math.max(0, Math.min(t, Math.max(0, projectDuration())));
  if (state.playing && !keepPlaying) pause();
  state.time = t;
  if (state.playing) { playFrom = t; playT0 = performance.now(); audio.schedule(state.project, state.media, t); }
  bus.emit('time');
  dirty = true;
}

// ---------- importación ----------
let importLane = null;
function pickFiles(opts = {}) {
  const fi = $('fileIn');
  importLane = opts.lane || null;
  fi.accept = opts.accept || 'video/*,image/*,audio/*';
  fi.click();
}
$('fileIn').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) await importFiles(files, true);
});

function makeThumb(src, w, hgt) {
  const th = 150;
  const tw = Math.round((w / hgt) * th) || 100;
  const c = document.createElement('canvas');
  c.width = Math.min(400, tw); c.height = th;
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.7); } catch (e) { return ''; }
}

async function createMedia(file, id = uid('m'), opts = {}) {
  const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : (/\.(mp4|mov|m4v|webm)$/i.test(file.name || '') ? 'video' : /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name || '') ? 'audio' : 'image');
  const m = { id, name: opts.name || file.name || 'Medio', kind, blob: file, url: URL.createObjectURL(file), w: 0, h: 0, duration: 0, el: null, buffer: null, thumb: opts.thumb || '', saved: !!opts.saved };
  if (kind === 'video') {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
    v.src = m.url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('No se pudo leer el vídeo')); setTimeout(res, 15000); });
    m.w = v.videoWidth || 1080; m.h = v.videoHeight || 1920; m.duration = isFinite(v.duration) ? v.duration : 0;
    if (!m.thumb) {
      try {
        await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(0.2, (m.duration || 1) / 3); setTimeout(res, 4000); });
        m.thumb = makeThumb(v, m.w, m.h);
      } catch (e) { /* sin miniatura */ }
    }
    v.removeAttribute('src'); v.load();
  } else if (kind === 'image') {
    const img = new Image();
    img.src = m.url;
    await img.decode().catch(() => new Promise((res) => { img.onload = res; img.onerror = res; }));
    m.el = img; m.w = img.naturalWidth || 1080; m.h = img.naturalHeight || 1080;
    if (!m.thumb) m.thumb = makeThumb(img, m.w, m.h);
  }
  state.media.set(m.id, m);
  if (kind !== 'image') {
    await audio.decode(m);
    if (kind === 'audio') m.duration = m.buffer ? m.buffer.duration : m.duration;
    if (kind === 'audio' && !m.duration) {
      const a = new Audio(m.url);
      await new Promise((res) => { a.onloadedmetadata = res; a.onerror = res; setTimeout(res, 8000); });
      m.duration = isFinite(a.duration) ? a.duration : 10;
    }
  }
  return m;
}

async function importFiles(files, addToTimeline) {
  toast(`Cargando ${files.length > 1 ? files.length + ' archivos' : 'archivo'}…`, 60000);
  let ok = 0;
  for (const f of files) {
    try {
      const m = await createMedia(f);
      ok++;
      if (addToTimeline) addMediaToTimeline(m, true, m.kind !== 'audio' ? importLane : null);
    } catch (err) {
      toast('No se pudo abrir ' + f.name + ': ' + err.message, 5000);
    }
  }
  importLane = null;
  bus.emit('media');
  if (ok) toast(ok === 1 ? 'Añadido ✓' : `${ok} archivos añadidos ✓`);
  updateEmpty();
}

function laneEnd(lane) {
  let e = 0;
  for (const c of state.project.clips) if (c.lane === lane) e = Math.max(e, c.start + c.dur);
  return e;
}

function addMediaToTimeline(m, quiet, lane) {
  let c;
  if (m.kind === 'audio') c = makeAudioClip(m, quiet && !state.project.clips.length ? 0 : state.time);
  else if (lane === 'overlay') { c = makeVisualClip(m, state.time, 'overlay'); c.tf.scale = 0.6; }
  else c = makeVisualClip(m, laneEnd('video'), 'video');
  addClip(c);
  select(c.id);
  if (!quiet) toast('Añadido a la línea de tiempo ✓');
  updateEmpty();
  dirty = true;
}

function addText(preset) {
  const p = structuredClone(preset);
  const upper = p.upper; delete p.upper;
  const c = makeTextClip(state.time, p);
  if (upper) c.upper = true;
  addClip(c);
  select(c.id);
  updateEmpty();
  dirty = true;
}

function addFx(id, kind) {
  const c = makeFxClip(id, state.time, kind);
  const end = projectDuration();
  if (end > state.time + 0.5) c.dur = Math.min(c.dur, Math.max(1, end - state.time)) || 4;
  addClip(c);
  select(c.id);
  updateEmpty();
  play(c.start, c.start + Math.min(c.dur, 3));
}

// ---------- grabar voz ----------
async function recordVoice() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast('No hay permiso para usar el micrófono'); return; }
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const mt = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const startAt = state.time;
  const timer = h('b', { style: 'font-size:34px;font-variant-numeric:tabular-nums' }, '0:00');
  const t0 = performance.now();
  const iv = setInterval(() => (timer.textContent = fmtTime((performance.now() - t0) / 1000, false)), 250);
  const stopBtn = h('button', { class: 'btn gold block' }, '■ Parar y añadir');
  openModal([h('h2', {}, '🎙️ Grabando…'), h('p', { class: 'sub' }, 'Se reproducirá tu vídeo mientras hablas para que puedas narrar encima.'), timer, h('div', { style: 'height:14px' }), stopBtn], { dismissable: false });
  rec.start(250);
  if (projectDuration() > startAt + 0.2) {
    // reproducir el vídeo en silencio de referencia
    play(startAt);
  }
  stopBtn.onclick = () => rec.stop();
  rec.onstop = async () => {
    clearInterval(iv);
    pause();
    stream.getTracks().forEach((t) => t.stop());
    closeModal();
    const type = (rec.mimeType || mt || 'audio/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    const file = new File([blob], `Voz ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type });
    try {
      const m = await createMedia(file);
      const c = makeAudioClip(m, startAt);
      addClip(c);
      select(c.id);
      bus.emit('media');
      toast('Voz añadida ✓');
    } catch (e) { toast('No se pudo guardar la grabación'); }
  };
}

// ---------- recuadros de selección sobre la imagen ----------
const selLayer = $('selLayer');
const boxEls = new Map();
function boundsOf(id) { return textBounds.get(id) || renderer.bounds.get(id) || null; }
function updateSelBoxes() {
  const seen = new Set();
  if (!state.playing && state.sel.size) {
    const cr = canvas.getBoundingClientRect(), wr = $('canvasWrap').getBoundingClientRect();
    const sx = cr.width / renderer.W, sy = cr.height / renderer.H;
    for (const id of state.sel) {
      const b = boundsOf(id);
      if (!b) continue;
      seen.add(id);
      let el = boxEls.get(id);
      if (!el) { el = h('div', { class: 'sel-box' }, h('i', { class: 'hd tl' }), h('i', { class: 'hd tr' }), h('i', { class: 'hd bl' }), h('i', { class: 'hd br' })); selLayer.append(el); boxEls.set(id, el); }
      const w = Math.max(16, b.w * sx), hh = Math.max(16, b.h * sy);
      el.style.cssText = `left:${cr.left - wr.left + b.cx * sx - w / 2}px;top:${cr.top - wr.top + b.cy * sy - hh / 2}px;width:${w}px;height:${hh}px;transform:rotate(${b.rot}rad)`;
      el.classList.toggle('prim', id === state.selection);
    }
  }
  for (const [id, el] of boxEls) if (!seen.has(id)) { el.remove(); boxEls.delete(id); }
}
bus.on('select', () => { dirty = true; });

// Qué hay bajo el dedo: primero textos (el de más arriba), luego superpuestos y por último el vídeo principal
function hitTest(e) {
  const cr = canvas.getBoundingClientRect();
  const px = ((e.clientX - cr.left) / cr.width) * renderer.W, py = ((e.clientY - cr.top) / cr.height) * renderer.H;
  const pad = 14 * (renderer.W / cr.width);
  const inside = (b) => {
    const dx = px - b.cx, dy = py - b.cy, co = Math.cos(-b.rot), si = Math.sin(-b.rot);
    const x = dx * co - dy * si, y = dx * si + dy * co;
    return Math.abs(x) <= b.w / 2 + pad && Math.abs(y) <= b.h / 2 + pad;
  };
  const texts = [...textBounds.entries()].reverse();
  for (const [id, b] of texts) if (b.a > 0.05 && inside(b)) return getClip(id);
  const vis = [...renderer.bounds.entries()].reverse();
  for (const [id, b] of vis) if (b.a > 0.05 && inside(b)) return getClip(id);
  return null;
}

// ---------- gestos sobre la imagen ----------
const pointers = new Map();
let gesture = null;
let pickMode = null;
function pickColor(c, cb) {
  pickMode = { c, cb };
  canvas.style.cursor = 'crosshair';
  toast('Toca sobre la imagen el color que quieres quitar', 4000);
}
canvas.addEventListener('pointerdown', (e) => {
  if (pickMode) {
    const r = canvas.getBoundingClientRect();
    const { c, cb } = pickMode;
    pickMode = null;
    canvas.style.cursor = '';
    const was = c.chroma.on;
    c.chroma.on = false;
    renderer.render({ project: state.project, t: state.time, media: state.media, videoFor, overlay });
    const hex = renderer.readColor((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    c.chroma.on = was || true;
    c.chroma.color = hex;
    commit();
    dirty = true;
    cb && cb(hex);
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  let c = selectedClip();
  const t = state.time;
  const isVis = (k) => k && (k.type === 'video' || k.type === 'image' || k.type === 'text') && t >= k.start && t < k.start + k.dur;
  if (pointers.size === 1) {
    // tocar algo de la imagen lo selecciona (si ya está en el grupo seleccionado, el grupo se mantiene)
    const hit = hitTest(e);
    if (!hit) { if (!state.selectMode) select(null); gesture = null; return; }
    if (state.selectMode) { if (!state.sel.has(hit.id)) toggleSel(hit.id); else if (state.selection !== hit.id) { state.selection = hit.id; bus.emit('select'); } }
    else if (state.sel.has(hit.id)) { if (state.selection !== hit.id) { state.selection = hit.id; bus.emit('select'); } }
    else select(hit.id);
    c = hit;
  }
  if (!c || !isVis(c)) { gesture = null; return; }
  const r = canvas.getBoundingClientRect();
  // todos los clips visuales/texto seleccionados se mueven juntos
  const items = (state.sel.has(c.id) ? selectedClips() : [c]).filter((k) => k.type === 'video' || k.type === 'image' || k.type === 'text');
  const lt = (k) => Math.max(0, Math.min(k.dur, state.time - k.start));
  const snapItems = () => items.map((k) => {
    const P = k.type === 'text' ? ['x', 'y', 'size'] : ['tf.x', 'tf.y', 'tf.scale'];
    return { k, P, x0: valueAt(k, P[0], lt(k)), y0: valueAt(k, P[1], lt(k)), s0: valueAt(k, P[2], lt(k)), lt: lt(k) };
  });
  gesture = { r, items: snapItems(), snapItems, p0: { x: e.clientX, y: e.clientY }, d0: null, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = gesture;
  const pts = [...pointers.values()];
  if (pts.length >= 2) {
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (!g.d0) { g.d0 = d; g.items = g.snapItems(); return; }
    const k = d / g.d0;
    for (const it of g.items) {
      if (it.k.type === 'text') setValue(it.k, 'size', it.lt, Math.max(0.015, Math.min(0.4, it.s0 * k)));
      else setValue(it.k, 'tf.scale', it.lt, Math.max(0.05, Math.min(6, it.s0 * k)));
    }
  } else {
    const dx = (e.clientX - g.p0.x) / g.r.width, dy = (e.clientY - g.p0.y) / g.r.height;
    if (Math.abs(dx) + Math.abs(dy) < 0.004 && !g.moved) return;
    g.moved = true;
    for (const it of g.items) {
      const m = it.k.type === 'text' ? 2 : 1;
      setValue(it.k, it.P[0], it.lt, it.x0 + dx * m); setValue(it.k, it.P[1], it.lt, it.y0 + dy * m);
    }
  }
  dirty = true;
});
const endPtr = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0 && gesture) {
    gesture = null;
    commit();
    bus.emit('change', { timing: true });
  } else if (gesture) { gesture.d0 = null; const p = [...pointers.values()][0]; if (p) { gesture.p0 = p; gesture.items = gesture.snapItems(); } }
};
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);

// ---------- exportación ----------
function exportDims(q) {
  const { w, h: hh } = state.project;
  const s = q / Math.min(w, hh);
  return { w: Math.round((w * s) / 2) * 2, h: Math.round((hh * s) / 2) * 2 };
}

function openExport() {
  const dur = projectDuration();
  if (dur <= 0) { toast('El proyecto está vacío'); return; }
  if (!pickMime() || !canvas.captureStream) {
    openModal([h('h2', {}, 'No disponible'), h('p', { class: 'sub' }, 'Este navegador no permite grabar vídeo. Actualiza iPadOS/Safari o usa Chrome en el ordenador.'), h('button', { class: 'btn block', onclick: closeModal }, 'Cerrar')]);
    return;
  }
  let q = 1080;
  const opt = (val, title, sub) => {
    const b = h('button', { class: 'card' + (q === val ? ' on' : ''), style: 'min-height:90px' }, h('b', { style: 'font-size:18px' }, title), h('small', {}, sub));
    b.onclick = () => { q = val; [...b.parentNode.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
    return b;
  };
  const d1 = exportDims(720), d2 = exportDims(1080);
  openModal([
    h('h2', {}, '⬇ Exportar vídeo'),
    h('p', { class: 'sub' }, `Duración: ${fmtTime(dur)} · Formato ${state.project.aspect}. Deja esta pantalla abierta y sin bloquear mientras se crea el vídeo.`),
    h('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr' }, opt(720, '720p', `${d1.w}×${d1.h} · más rápido`), opt(1080, '1080p', `${d2.w}×${d2.h} · recomendado`)),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn gold', onclick: () => runExport(q) }, 'Empezar')),
  ]);
}

function seekVideo(v, t) {
  return new Promise((res) => {
    let fin = false;
    const done = () => { if (fin) return; fin = true; v.removeEventListener('seeked', done); v.removeEventListener('loadeddata', done); res(); };
    v.addEventListener('seeked', done);
    v.addEventListener('loadeddata', done);
    if (Math.abs(v.currentTime - t) > 0.0005) v.currentTime = t;
    else if (v.readyState >= 2) done();
    setTimeout(done, 4000);
  });
}

async function prepareFrame(t) {
  const waits = [];
  for (const c of state.project.clips) {
    if (c.type !== 'video') continue;
    const v = videoFor(c);
    if (!v) continue;
    if (!v.paused) v.pause();
    if (t >= c.start && t < c.start + c.dur) {
      const m = state.media.get(c.media);
      const target = Math.min(Math.max(0, c.in + (t - c.start) * c.speed), Math.max(0, (m.duration || 1e9) - 0.02));
      if (v.readyState < 2 || Math.abs(v.currentTime - target) > 0.0005) waits.push(seekVideo(v, target));
    }
  }
  await Promise.all(waits);
}

let offlineBusy = false;

async function runExport(q) {
  pause();
  select(null);
  const dur = projectDuration();
  const d = exportDims(q);
  const fps = 30;
  const bitrate = q >= 1080 ? 12_000_000 : 7_000_000;
  const bar = h('i');
  const pctEl = h('b', {}, '0%');
  const modeEl = h('p', { class: 'hint' }, 'Preparando…');
  let cancelled = false;
  openModal([
    h('h2', {}, 'Exportando…'),
    h('p', { class: 'sub' }, 'No cierres ni cambies de pestaña, y no bloquees la pantalla.'),
    h('div', { class: 'progress' }, bar), pctEl, modeEl,
    h('div', { style: 'height:14px' }),
    h('button', { class: 'btn block', onclick: () => { cancelled = true; pause(); exporting && exporting.finish(); } }, 'Cancelar'),
  ], { dismissable: false });
  const progress = (p) => { bar.style.width = Math.min(100, p * 100) + '%'; pctEl.textContent = Math.round(Math.min(100, p * 100)) + '%'; };
  audio.init();
  keepAwake(true);

  // ---- 1) fotograma a fotograma ----
  const wantAudio = audio.hasAudio(state.project, state.media);
  let cfg = null;
  try { cfg = await offlineConfig(d.w, d.h, fps, bitrate, wantAudio); } catch (e) { cfg = null; }
  if (cfg && !window.__forceRealtime) {
    modeEl.textContent = 'Modo alta calidad: fotograma a fotograma.';
    offlineBusy = true;
    exporting = { progress, finish: () => {} };
    renderer.resize(d.w, d.h);
    try {
      const abuf = wantAudio ? await audio.renderOffline(state.project, state.media, dur) : null;
      const blob = await exportOffline({
        canvas, w: d.w, h: d.h, fps, dur, cfg, audioBuffer: abuf, onProgress: progress, isCancelled: () => cancelled,
        renderFrame: async (t) => {
          state.time = t;
          await prepareFrame(t);
          renderer.render({ project: state.project, t, media: state.media, videoFor, overlay });
        },
      });
      offlineBusy = false; exporting = null; keepAwake(false); applyPreviewSize(); seek(0);
      if (cancelled || !blob) { closeModal(); toast('Exportación cancelada'); return; }
      showResult(blob, 'mp4', dur);
      return;
    } catch (e) {
      console.warn('Exportación fotograma a fotograma falló, uso tiempo real', e);
      offlineBusy = false; exporting = null;
      if (cancelled) { applyPreviewSize(); closeModal(); toast('Exportación cancelada'); return; }
    }
  }

  // ---- 2) tiempo real ----
  modeEl.textContent = 'Grabando en tiempo real (tarda lo mismo que dura el vídeo).';
  renderer.resize(d.w, d.h);
  // preparar fotogramas iniciales
  seek(0);
  syncVideos(0);
  await new Promise((r) => setTimeout(r, 600));
  let rec;
  try {
    rec = startRecorder(canvas, audio.exportDest && audio.exportDest.stream, { bitrate: q >= 1080 ? 12_000_000 : 7_000_000, fps: 30 });
  } catch (e) {
    closeModal(); applyPreviewSize(); toast(e.message, 5000); return;
  }
  const done = new Promise((res) => { exporting = { progress, finish: res }; });
  await new Promise((r) => setTimeout(r, 250));
  play(0);
  await done;
  await new Promise((r) => setTimeout(r, 300));
  const blob = await rec.stop();
  exporting = null;
  keepAwake(false);
  applyPreviewSize();
  if (cancelled) { closeModal(); toast('Exportación cancelada'); return; }
  showResult(blob, rec.ext, dur);
}

function showResult(blob, ext, dur) {
  const name = (state.project.name || 'video').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '') + '.' + ext;
  const url = URL.createObjectURL(blob);
  const file = new File([blob], name, { type: blob.type });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  openModal([
    h('h2', {}, '✓ ¡Vídeo listo!'),
    h('p', { class: 'sub' }, `${name} · ${(blob.size / 1048576).toFixed(1)} MB · ${fmtTime(dur)}`),
    h('video', { src: url, controls: true, playsinline: true }),
    h('div', { class: 'row-btns' },
      h('a', { class: 'btn gold', href: url, download: name, style: 'text-decoration:none' }, '⬇ Guardar'),
      canShare ? h('button', { class: 'btn plum', onclick: () => navigator.share({ files: [file], title: name }).catch(() => {}) }, '↗ Compartir / Guardar en Fotos') : null),
    ext === 'webm' ? h('p', { class: 'hint' }, 'Tu navegador ha creado un archivo .webm. Si alguna app no lo acepta, exporta desde Safari o desde un Chrome actualizado para obtener .mp4.') : null,
    h('button', { class: 'btn block', onclick: closeModal }, 'Cerrar'),
  ]);
}

// ---------- proyecto ----------
function openProject() {
  const name = h('input', { type: 'text', value: state.project.name });
  const grid = h('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr' });
  for (const [k, a] of Object.entries(ASPECTS)) {
    const ar = a.w / a.h;
    const b = h('button', { class: 'card' + (state.project.aspect === k ? ' on' : ''), style: 'min-height:120px' },
      h('div', { style: `width:${ar >= 1 ? 54 : 54 * ar}px;height:${ar >= 1 ? 54 / ar : 54}px;border:3px solid var(--plum);border-radius:6px` }),
      h('b', {}, a.name), h('small', {}, a.sub));
    b.onclick = () => { setAspect(k, a); applyPreviewSize(); [...grid.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); updateProjChip(); };
    grid.append(b);
  }
  openModal([
    h('h2', {}, 'Proyecto'),
    h('div', { class: 'field' }, h('label', {}, 'Nombre'), name),
    h('div', { class: 'field' }, h('label', {}, 'Formato')), grid,
    h('div', { style: 'height:16px' }),
    h('button', { class: 'btn gold block', onclick: () => { state.project.name = name.value.trim() || 'Mi vídeo'; commit(); updateProjChip(); closeModal(); } }, 'Guardar'),
    h('div', { style: 'height:10px' }),
    h('button', { class: 'btn danger block', onclick: newProject }, '✦ Empezar un proyecto nuevo'),
  ]);
}

async function newProject() {
  if (!confirm('¿Empezar un proyecto nuevo? Se borrará el actual de este dispositivo.')) return;
  pause();
  for (const m of state.media.values()) URL.revokeObjectURL(m.url);
  state.media.clear();
  await clearSaved();
  loadProject({ name: 'Mi vídeo', aspect: '9:16', w: 1080, h: 1920, fps: 30, bg: '#000000', clips: [] });
  cleanupVideos();
  bus.emit('media');
  closeModal();
  applyPreviewSize();
  updateProjChip();
  updateEmpty();
}

function updateProjChip() {
  $('projName').textContent = state.project.name;
  $('projAspect').textContent = state.project.aspect;
}
function updateEmpty() {
  $('canvasWrap').classList.toggle('has-media', state.project.clips.length > 0);
}
function updateUndo() {
  $('btnUndo').disabled = !canUndo();
  $('btnRedo').disabled = !canRedo();
}

// ---------- app compartida con paneles/timeline ----------
const app = {
  audio, pause, openSubtitles: () => openSubtitles(app), openSubEditor: () => openSubEditor(app), subCount: () => subClips().length,
  seek, pickFiles, addMediaToTimeline: (m, q, lane) => addMediaToTimeline(m, q, lane), addText, addFx, recordVoice, openProject,
  changed: () => { dirty = true; },
  audioChanged: () => { if (state.playing) audio.schedule(state.project, state.media, state.time); },
  preview: (from, len) => play(Math.max(0, from), from + len),
  pickColor: (c, cb) => pickColor(c, cb),
  showInspector: null,
};
const timeline = new Timeline($('tlScroll'), $('tlInner'), app);
const panels = new Panels(app);

// ---------- eventos ----------
bus.on('change', (e) => {
  dirty = true;
  $('tcTotal').textContent = fmtTime(projectDuration());
  if (e && e.aspect) applyPreviewSize();
  if (e && e.structural) { cleanupVideos(); updateEmpty(); }
  if (state.playing && e && (e.structural || e.timing)) audio.schedule(state.project, state.media, state.time);
});
bus.on('time', () => { $('tcNow').textContent = fmtTime(state.time); });
bus.on('fontloaded', () => (dirty = true));
let saveTimer = null;
bus.on('commit', () => {
  updateUndo();
  $('tcTotal').textContent = fmtTime(projectDuration());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject(state.project, state.media), 900);
});

$('btnPlay').onclick = () => (state.playing ? pause() : play());
$('btnToStart').onclick = () => seek(0);
$('btnUndo').onclick = () => { pause(); undo(); };
$('btnRedo').onclick = () => { pause(); redo(); };
$('btnExport').onclick = openExport;
$('btnProject').onclick = openProject;
$('btnHintImport').onclick = pickFiles;
$('btnFull').onclick = () => {
  const el = $('canvasWrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
};
function targetIds() { return [...state.sel]; }
$('tSplit').onclick = () => {
  let ids = targetIds();
  if (!ids.length) ids = state.project.clips.filter((k) => k.lane === 'video' && state.time > k.start && state.time < k.start + k.dur).map((k) => k.id);
  if (!ids.length || !splitClips(ids, state.time).length) toast('Coloca el cabezal dentro de un clip para dividirlo');
};
$('tDup').onclick = () => { const ids = targetIds(); if (ids.length) duplicateClips(ids); else toast('Selecciona un clip'); };
$('tKf').onclick = () => {
  const c = selectedClip();
  if (!c) { toast('Toca primero un clip'); return; }
  const lt = state.time - c.start;
  if (lt < -1e-3 || lt > c.dur + 1e-3) { toast('Pon el cabezal dentro del clip'); return; }
  const added = toggleAllKf(c, Math.max(0, Math.min(c.dur, lt)));
  commit(); bus.emit('kf'); dirty = true; if (state.playing) audio.schedule(state.project, state.media, state.time);
  toast(added ? '◆ Keyframe añadido: cambia ahora los valores' : 'Keyframe quitado');
  refreshKfBtn();
};
function refreshKfBtn() {
  const c = selectedClip();
  $('tKf').classList.toggle('on', !!(c && anyKfAt(c, state.time - c.start)));
}
bus.on('time', refreshKfBtn); bus.on('select', refreshKfBtn); bus.on('kf', refreshKfBtn);
$('tDel').onclick = () => { const ids = targetIds(); if (ids.length) removeClips(ids); else toast('Selecciona un clip'); };

// ---- tiradores: tamaño de la línea de tiempo, del panel y de la hoja ----
(function resizers() {
  const root = $('app');
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* */ } };
  const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const setVar = (n, px) => root.style.setProperty(n, Math.round(px) + 'px');
  const drag = (el, onMove, key, onEnd) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag'); document.body.classList.add('resizing');
      const start = { x: e.clientX, y: e.clientY };
      const mv = (ev) => onMove(ev, start);
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        el.classList.remove('drag'); document.body.classList.remove('resizing');
        onEnd && onEnd();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  };
  // línea de tiempo (arriba/abajo)
  let tlStart = 0;
  $('rzTl').addEventListener('pointerdown', () => { tlStart = $('tl').getBoundingClientRect().height; }, true);
  drag($('rzTl'), (ev, s) => {
    const max = window.innerHeight - 230, h = Math.max(120, Math.min(max, tlStart - (ev.clientY - s.y)));
    setVar('--tl-h', h);
  }, 'tlh', () => { store('tlh', $('tl').getBoundingClientRect().height); timeline.render(); });
  $('rzTl').addEventListener('dblclick', () => { root.style.removeProperty('--tl-h'); store('tlh', ''); });
  // panel lateral (izquierda/derecha)
  let pw0 = 0;
  $('rzPanel').addEventListener('pointerdown', () => { pw0 = $('panel').getBoundingClientRect().width; }, true);
  drag($('rzPanel'), (ev, s) => {
    const w = Math.max(300, Math.min(Math.min(760, window.innerWidth - 380), pw0 - (ev.clientX - s.x)));
    setVar('--panel-w', w);
  }, 'pw', () => store('pw', $('panel').getBoundingClientRect().width));
  // hoja del panel en iPad vertical (arrastrando su cabecera)
  let sh0 = 0;
  $('panelHead').addEventListener('pointerdown', () => { sh0 = $('panel').getBoundingClientRect().height; }, true);
  drag($('panelHead'), (ev, s) => {
    if (window.innerWidth >= 1000) return;
    const hgt = Math.max(180, Math.min(window.innerHeight - 140, sh0 - (ev.clientY - s.y)));
    setVar('--sheet-h', hgt);
  }, 'sh', () => { if (window.innerWidth < 1000) store('sh', $('panel').getBoundingClientRect().height); });
  const t = +load('tlh'), p = +load('pw'), sh = +load('sh');
  if (t > 100 && t < window.innerHeight - 200) setVar('--tl-h', t);
  if (p >= 300) setVar('--panel-w', p);
  if (sh >= 180 && sh < window.innerHeight - 100) setVar('--sheet-h', sh);
})();

// ---- mini reproductor dentro del panel (iPad vertical) ----
$('mBack').replaceChildren(icon('prev', 22)); $('mFwd').replaceChildren(icon('next', 22));
$('mPlay').onclick = () => { state.playing ? pause() : play(); };
$('mBack').onclick = () => seek(state.time - 0.5);
$('mFwd').onclick = () => seek(state.time + 0.5);
const syncMini = () => { $('mTc').textContent = fmtTime(state.time); $('mPlay').textContent = state.playing ? '❚❚' : '▶'; };
bus.on('time', syncMini);
setInterval(syncMini, 400);

// ---- modo selección múltiple ----
function refreshSelUI() {
  $('tSel').classList.toggle('on', state.selectMode);
  $('tSel').setAttribute('aria-pressed', state.selectMode);
  $('selBar').hidden = !state.selectMode;
  const n = state.sel.size;
  $('selCount').textContent = n === 1 ? '1 clip' : n + ' clips';
  $('tDel').querySelector('span').textContent = n > 1 ? `Eliminar (${n})` : 'Eliminar';
}
bus.on('select', refreshSelUI);
bus.on('selectmode', refreshSelUI);
$('tSel').onclick = () => setSelectMode(!state.selectMode);
$('sAll').onclick = () => selectIds(state.project.clips.map((k) => k.id));
$('sNone').onclick = () => selectIds([]);
$('sFrom').onclick = () => selectIds(state.project.clips.filter((k) => k.start + k.dur > state.time + 0.01).map((k) => k.id));
$('sLane').onclick = () => {
  const p = selectedClip();
  if (!p) { toast('Toca primero un clip de la pista que quieres elegir'); return; }
  selectIds(state.project.clips.filter((k) => k.lane === p.lane).map((k) => k.id));
};
const zoom = $('zoom');
zoom.oninput = () => timeline.setZoom(+zoom.value);
$('zIn').onclick = () => { zoom.value = Math.min(300, +zoom.value * 1.35); timeline.setZoom(+zoom.value); };
$('zOut').onclick = () => { zoom.value = Math.max(20, +zoom.value / 1.35); timeline.setZoom(+zoom.value); };

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.code === 'Space') { e.preventDefault(); state.playing ? pause() : play(); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); pause(); e.shiftKey ? redo() : undo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { const ids = targetIds(); if (ids.length) { e.preventDefault(); removeClips(ids); } }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectIds(state.project.clips.map((k) => k.id)); }
  else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) $('tSplit').click();
  else if (e.key === 'ArrowRight') seek(state.time + (e.shiftKey ? 1 : 1 / 30));
  else if (e.key === 'ArrowLeft') seek(state.time - (e.shiftKey ? 1 : 1 / 30));
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing && !exporting) pause(); });

// ---------- recuperar proyecto guardado ----------
(async function init() {
  applyPreviewSize();
  resetHistory();
  updateUndo();
  const saved = await loadSaved();
  if (saved && saved.project && saved.project.clips && saved.project.clips.length) {
    toast('Recuperando tu proyecto…', 30000);
    for (const r of saved.media) {
      try { await createMedia(r.blob, r.id, { name: r.name, thumb: r.thumb, saved: true }); } catch (e) { /* medio perdido */ }
    }
    const p = saved.project;
    p.clips = p.clips.filter((c) => !c.media || state.media.has(c.media));
    loadProject(p);
    bus.emit('media');
    toast('Proyecto recuperado ✓');
  }
  updateProjChip();
  updateEmpty();
  timeline.render();
  $('tcTotal').textContent = fmtTime(projectDuration());
  dirty = true;
})();

// acceso para pruebas
window.__editor = { state, app, play, pause, seek, importFiles, renderer, timeline, panels };

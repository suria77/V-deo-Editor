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
import { clearSpectrumCache } from './spectrum.js';
import { saveProject, loadSaved, listProjects, openSavedProject, deleteProject, renameProject, duplicateProject, libList, libAdd, libGet, libDelete, libRename, askPersistent, storageInfo } from './storage.js';
import { ASPECTS, loadExtraFonts, PARTICLES, POSTFX } from './presets.js';
import { SPEC_STYLES } from './spectrum.js';
import { layerInfo, swapContent, replaceMedia } from './layers.js';
loadExtraFonts();
import { h, fmtTime, toast, openModal, closeModal } from './ui.js';
import { openSubtitles, openSubEditor, subClips } from './subs.js';
import { icon } from './icons.js';
import { xfadeAt } from './xfade.js';
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
// Libera el decodificador de los clips lejanos al cabezal (Safari limita cuántos vídeos puede tener abiertos a la vez)
const VID_WINDOW = 3;
function farFrom(c, t) { return (t < c.start ? c.start - t : t > c.start + c.dur ? t - (c.start + c.dur) : 0) > VID_WINDOW; }
function releaseVideo(id) {
  const v = videoEls.get(id);
  if (!v) return;
  const c = getClip(id), m = c && state.media.get(c.media);
  if (m && m.audioFallback) return; // estos suenan por su propio <video> ya autorizado: no se recrean
  v.pause(); v.removeAttribute('src'); v.load(); v.remove(); videoEls.delete(id); renderer.releaseClip(id);
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
  const xf = xfadeAt(state.project, t);
  for (const c of state.project.clips) {
    if (c.type !== 'video') continue;
    if (farFrom(c, t) && !xf.has(c.id)) { releaseVideo(c.id); continue; }
    const v = videoFor(c);
    if (!v) continue;
    const inClip = t >= c.start && t < c.start + c.dur;
    const active = inClip || xf.has(c.id);
    elementAudio(c, v, inClip, t);
    const m0 = state.media.get(c.media);
    const target = Math.min(c.in + Math.max(0, t - c.start) * c.speed, Math.max(0, ((m0 && m0.duration) || 1e9) - 0.03));
    if (active && t < c.start) {
      // el clip que entra en una transición: primer fotograma quieto
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.02 && !v.seeking) v.currentTime = target;
    } else if (active) {
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
let loopErr = 0;
function loop(now) {
  requestAnimationFrame(loop);
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
    try {
      syncVideos(state.time);
      renderer.render({ project: state.project, t: state.time, media: state.media, videoFor, overlay });
      if (exporting) exporting.progress(state.time / Math.max(0.01, projectDuration()));
      else updateSelBoxes();
    } catch (err) {
      // un error en un clip no debe congelar toda la vista previa
      if (loopErr++ < 3) toast('Hay un clip con datos dañados: ' + (err && err.message ? err.message : 'error'), 5000);
      console.error(err);
    }
  }
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
  replaceTarget = opts.replace || null;
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

// Tira de fotogramas para la línea de tiempo: se genera en segundo plano, de uno en uno, y solo en vídeos no enormes
const frameQueue = [];
let frameBusy = false;
function genFrames(m) {
  if (m.kind !== 'video' || m.frames || !m.duration || m.duration > 900 || (m.blob && m.blob.size > 600 * 1048576)) return;
  frameQueue.push(m);
  if (!frameBusy) runFrameQueue();
}
async function runFrameQueue() {
  frameBusy = true;
  while (frameQueue.length) {
    const m = frameQueue.shift();
    if (!state.media.has(m.id)) continue;
    try {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
      v.src = m.url;
      await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 8000); });
      const N = Math.min(40, Math.max(2, Math.ceil(m.duration / 1.5)));
      const step = m.duration / N;
      const H = 72, W = Math.max(20, Math.round((m.w / m.h) * H));
      const frames = [];
      for (let i = 0; i < N; i++) {
        if (!state.media.has(m.id)) break;
        await seekVideo(v, Math.min(m.duration - 0.05, i * step + step / 2));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        cv.getContext('2d').drawImage(v, 0, 0, W, H);
        frames.push(cv);
      }
      v.removeAttribute('src'); v.load();
      if (frames.length === N) { m.frames = frames; m.fstep = step; bus.emit('frames'); }
    } catch (e) { /* sin tira de fotogramas: se usa la miniatura */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  frameBusy = false;
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
  if (kind === 'video') setTimeout(() => genFrames(m), 600);
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
      if (replaceTarget) {
        const c = getClip(replaceTarget);
        replaceTarget = null;
        if (c && replaceMedia(c, m)) { select(c.id); dirty = true; toast('Sustituido ✓'); }
        else toast('Ese archivo no sirve para sustituir este clip', 4000);
        continue;
      }
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
  // la animación de entrada empieza en transparente: se coloca el cabezal justo después para que el texto se vea al añadirlo
  if (!state.playing && c.inAnim && c.inAnim.type !== 'none') seek(c.start + Math.min(c.dur * 0.5, (c.inAnim.dur || 0) + 0.05));
  updateEmpty();
  dirty = true;
}

// ---------- sustituir ----------
let replaceTarget = null;
function replaceClip(c) {
  if (!c) return;
  if (c.type === 'fx') {
    const list = c.kind === 'post' ? POSTFX : c.kind === 'spectrum' ? SPEC_STYLES : PARTICLES;
    const grid = h('div', { class: 'grid' }, ...list.map((d) => h('button', {
      class: 'card' + (d.id === c.fx ? ' on' : ''),
      onclick: () => {
        c.fx = d.id;
        if (c.kind === 'spectrum') c.style = d.id;
        else if (c.kind !== 'post') { c.color = d.color || c.color; }
        commit(); bus.emit('change', { structural: true, keepPanel: true });
        closeModal(); dirty = true; toast('Efecto sustituido ✓');
        play(c.start, c.start + Math.min(c.dur, 3));
      },
    }, h('small', {}, d.n))));
    openModal(h('div', {}, h('h2', {}, 'Sustituir efecto'), h('p', { class: 'hint' }, 'Elige el efecto que va en su lugar. Se mantienen la duración y el sitio en la línea de tiempo.'), grid,
      h('button', { class: 'btn block', style: 'margin-top:14px', onclick: closeModal }, 'Cancelar')));
    return;
  }
  const audioClip = c.type === 'audio';
  const ok = (m) => (audioClip ? m.kind !== 'image' : m.kind !== 'audio') && m.id !== c.media;
  const items = [...state.media.values()].filter(ok);
  const fromDevice = () => {
    closeModal();
    pickFiles({ accept: audioClip ? 'audio/*,video/*' : 'video/*,image/*', replace: c.id });
  };
  const grid = panels.mediaGrid(items, (m) => { if (replaceMedia(c, m)) { closeModal(); select(c.id); dirty = true; toast('Sustituido ✓'); } });
  openModal(h('div', {}, h('h2', {}, audioClip ? 'Sustituir audio' : 'Sustituir vídeo o foto'),
    h('p', { class: 'hint' }, 'Lo nuevo ocupa el mismo sitio y conserva la posición, el tamaño, los filtros y los efectos.'),
    h('button', { class: 'btn block accent', onclick: fromDevice }, '📂 Elegir del dispositivo…'),
    items.length ? h('div', { class: 'field', style: 'margin-top:14px' }, h('label', {}, 'O uno de tus medios')) : null,
    items.length ? grid : null,
    h('button', { class: 'btn block', style: 'margin-top:14px', onclick: closeModal }, 'Cancelar')));
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
      const c = makeAudioClip(m, startAt); c.role = 'voice';
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
      // botón ⇅ para intercambiar con lo que hay debajo (o encima, si es el vídeo principal)
      let sw = el.querySelector('.swap-btn');
      const c = id === state.selection && state.sel.size === 1 ? getClip(id) : null;
      const li = c && (c.type === 'video' || c.type === 'image') ? layerInfo(c) : null;
      const other = li ? (c.lane === 'overlay' ? li.below || li.above : li.above) : null;
      if (other) {
        if (!sw) {
          sw = h('button', { class: 'swap-btn', title: 'Intercambiar con el de debajo', 'aria-label': 'Intercambiar capas' }, '⇅');
          sw.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const k = getClip(state.selection);
            const l2 = k ? layerInfo(k) : null;
            const o = l2 ? (k.lane === 'overlay' ? l2.below || l2.above : l2.above) : null;
            if (o && swapContent(k, o)) { toast('Intercambiados ✓'); dirty = true; }
          });
          el.append(sw);
        }
      } else if (sw) sw.remove();
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
// Los gestos se escuchan en toda la zona de la imagen (como en CapCut): aunque el dedo esté fuera del vídeo,
// arrastrar mueve el objeto seleccionado y pellizcar lo agranda/achica (y con dos dedos también se gira).
const stageWrap = $('canvasWrap');
const onCanvas = (e) => { const r = canvas.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
stageWrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest && e.target.closest('button, input, a')) return;
  if (pickMode) {
    if (!onCanvas(e)) return;
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
  try { stageWrap.setPointerCapture(e.pointerId); } catch (_) { /* nada */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  let c = selectedClip();
  const t = state.time;
  const isVis = (k) => k && (k.type === 'video' || k.type === 'image' || k.type === 'text' || (k.type === 'fx' && k.kind === 'spectrum')) && t >= k.start && t < k.start + k.dur;
  if (pointers.size === 1) {
    if (onCanvas(e)) {
      // tocar algo de la imagen lo selecciona (si ya está en el grupo seleccionado, el grupo se mantiene)
      const hit = hitTest(e);
      if (!hit) {
        // tocar un hueco de la imagen: si hay algo seleccionado y visible, el arrastre lo sigue moviendo
        if (!isVis(c)) { if (!state.selectMode) select(null); gesture = null; return; }
      } else {
        if (state.selectMode) { if (!state.sel.has(hit.id)) toggleSel(hit.id); else if (state.selection !== hit.id) { state.selection = hit.id; bus.emit('select'); } }
        else if (state.sel.has(hit.id)) { if (state.selection !== hit.id) { state.selection = hit.id; bus.emit('select'); } }
        else select(hit.id);
        c = hit;
      }
    }
    // fuera de la imagen: se manipula lo que ya esté seleccionado, sin cambiar la selección
  }
  if (!c || !isVis(c)) { gesture = null; return; }
  const r = canvas.getBoundingClientRect();
  // todos los clips visuales/texto seleccionados se mueven juntos
  const items = (state.sel.has(c.id) ? selectedClips() : [c]).filter((k) => k.type === 'video' || k.type === 'image' || k.type === 'text' || (k.type === 'fx' && k.kind === 'spectrum'));
  const lt = (k) => Math.max(0, Math.min(k.dur, state.time - k.start));
  const snapItems = () => items.map((k) => {
    const sp = k.type === 'fx';
    const P = k.type === 'text' ? ['x', 'y', 'size', 'rot'] : sp ? ['x', 'y', 'width', 'rot'] : ['tf.x', 'tf.y', 'tf.scale', 'tf.rot'];
    return { k, P, sp, h0: sp ? (k.height ?? 0.32) : 0, rad0: sp ? (k.radius ?? 0.2) : 0, x0: valueAt(k, P[0], lt(k)), y0: valueAt(k, P[1], lt(k)), s0: valueAt(k, P[2], lt(k)), r0: valueAt(k, P[3], lt(k)) || 0, lt: lt(k) };
  });
  gesture = { r, items: snapItems(), snapItems, p0: { x: e.clientX, y: e.clientY }, d0: null, a0: 0, moved: false };
});
stageWrap.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = gesture;
  const pts = [...pointers.values()];
  if (pts.length >= 2) {
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    if (!g.d0) { g.d0 = Math.max(10, d); g.a0 = ang; g.m0 = mid; g.items = g.snapItems(); return; }
    const k = d / g.d0;
    let da = ((ang - g.a0) * 180) / Math.PI;
    if (da > 180) da -= 360; else if (da < -180) da += 360;
    if (Math.abs(da) < 6) da = 0; // pequeño margen para que al pellizcar no se tuerza sin querer
    else da -= Math.sign(da) * 6;
    const mdx = (mid.x - g.m0.x) / g.r.width, mdy = (mid.y - g.m0.y) / g.r.height;
    for (const it of g.items) {
      if (it.k.type === 'text') setValue(it.k, 'size', it.lt, Math.max(0.015, Math.min(0.4, it.s0 * k)));
      else if (it.sp) { setValue(it.k, 'width', it.lt, Math.max(0.1, Math.min(1.6, it.s0 * k))); setValue(it.k, 'height', it.lt, Math.max(0.04, Math.min(0.9, it.h0 * k))); setValue(it.k, 'radius', it.lt, Math.max(0.05, Math.min(0.6, it.rad0 * k))); }
      else setValue(it.k, 'tf.scale', it.lt, Math.max(0.05, Math.min(6, it.s0 * k)));
      if (da !== 0 || g.rotated) {
        g.rotated = true;
        let rot = it.r0 + da;
        const near = Math.round(rot / 90) * 90;
        if (Math.abs(rot - near) < 3) rot = near; // imán a 0°, 90°, 180°…
        setValue(it.k, it.P[3], it.lt, Math.max(-180, Math.min(180, rot)));
      }
      if (Math.abs(mdx) + Math.abs(mdy) > 0.003 || g.panned) {
        g.panned = true;
        const m = it.k.type === 'text' || it.sp ? 2 : 1;
        setValue(it.k, it.P[0], it.lt, it.x0 + mdx * m); setValue(it.k, it.P[1], it.lt, it.y0 + mdy * m);
      }
    }
  } else {
    const dx = (e.clientX - g.p0.x) / g.r.width, dy = (e.clientY - g.p0.y) / g.r.height;
    if (Math.abs(dx) + Math.abs(dy) < 0.004 && !g.moved) return;
    g.moved = true;
    for (const it of g.items) {
      const m = it.k.type === 'text' || it.sp ? 2 : 1;
      let nx = it.x0 + dx * m, ny = it.y0 + dy * m;
      if (g.items.length === 1) {
        // imán al centro de la pantalla, con líneas guía
        const sx = Math.abs(nx) < 0.025, sy = Math.abs(ny) < 0.025;
        if (sx) nx = 0; if (sy) ny = 0;
        $('guideV').hidden = !sx; $('guideH').hidden = !sy;
      }
      setValue(it.k, it.P[0], it.lt, nx); setValue(it.k, it.P[1], it.lt, ny);
    }
  }
  dirty = true;
});
const endPtr = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0 && gesture) {
    gesture = null;
    $('guideV').hidden = true; $('guideH').hidden = true;
    commit();
    bus.emit('change', { timing: true });
  } else if (gesture) { gesture.d0 = null; const p = [...pointers.values()][0]; if (p) { gesture.p0 = p; gesture.items = gesture.snapItems(); } }
};
stageWrap.addEventListener('pointerup', endPtr);
stageWrap.addEventListener('pointercancel', endPtr);
// en Safari (iPad) evita que el pellizco haga zoom a toda la página
['gesturestart', 'gesturechange'].forEach((ev) => stageWrap.addEventListener(ev, (e) => e.preventDefault()));

// ---------- exportación ----------
function exportDims(q) {
  const { w, h: hh } = state.project;
  const s = q / Math.min(w, hh);
  return { w: Math.round((w * s) / 2) * 2, h: Math.round((hh * s) / 2) * 2 };
}

function openExport() {
  const dur = projectDuration();
  if (dur <= 0) { toast('El proyecto está vacío'); return; }
  if ((!pickMime() || !canvas.captureStream) && !window.VideoEncoder) {
    openModal([h('h2', {}, 'No disponible'), h('p', { class: 'sub' }, 'Este navegador no permite grabar vídeo. Actualiza iPadOS/Safari o usa Chrome en el ordenador.'), h('button', { class: 'btn block', onclick: closeModal }, 'Cerrar')]);
    return;
  }
  const PRESETS = [
    { id: 'reel', n: 'Reel / TikTok / Short', q: 1080, fps: 30, br: 14e6, sub: 'Calidad alta · recomendado' },
    { id: 'yt', n: 'YouTube 1080p', q: 1080, fps: 30, br: 16e6, sub: 'Máxima calidad en Full HD' },
    { id: 'yt4k', n: 'YouTube 4K', q: 2160, fps: 30, br: 40e6, sub: 'Pesado: úsalo en vídeos cortos' },
    { id: 'f60', n: '1080p a 60 fps', q: 1080, fps: 60, br: 20e6, sub: 'Movimiento muy fluido' },
    { id: 'fast', n: 'Rápido 720p', q: 720, fps: 30, br: 7e6, sub: 'Para probar o enviar por chat' },
  ];
  let sel = PRESETS[0];
  const cards = PRESETS.map((p) => {
    const d = exportDims(p.q);
    const b = h('button', { class: 'card' + (p === sel ? ' on' : ''), style: 'min-height:74px;align-items:flex-start;text-align:left' }, h('b', { style: 'font-size:16px' }, p.n), h('small', {}, `${d.w}×${d.h} · ${p.fps} fps · ${p.sub}`));
    b.onclick = () => { sel = p; cards.forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
    return b;
  });
  openModal([
    h('h2', {}, 'Exportar vídeo'),
    h('p', { class: 'sub' }, `Duración: ${fmtTime(dur)} · Formato ${state.project.aspect}. Deja esta pantalla abierta y sin bloquear mientras se crea el vídeo.`),
    h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, ...cards),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn gold', onclick: () => runExport(sel.q, sel) }, 'Empezar')),
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
  const xf = xfadeAt(state.project, t);
  for (const c of state.project.clips) {
    if (c.type !== 'video') continue;
    if (farFrom(c, t) && !xf.has(c.id)) { releaseVideo(c.id); continue; }
    const v = videoFor(c);
    if (!v) continue;
    if (!v.paused) v.pause();
    if ((t >= c.start && t < c.start + c.dur) || xf.has(c.id)) {
      const m = state.media.get(c.media);
      const target = Math.min(Math.max(0, c.in + Math.max(0, t - c.start) * c.speed), Math.max(0, (m.duration || 1e9) - 0.02));
      if (v.readyState < 2 || Math.abs(v.currentTime - target) > 0.0005) waits.push(seekVideo(v, target));
    }
  }
  await Promise.all(waits);
}

let offlineBusy = false;

async function runExport(q, preset = { fps: 30, br: q >= 1080 ? 12e6 : 7e6 }) {
  pause();
  select(null);
  const dur = projectDuration();
  const d = exportDims(q);
  const fps = preset.fps || 30;
  const bitrate = preset.br || 12e6;
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
      try { await Promise.all(state.project.clips.filter((k) => k.type === 'text' && k.font).map((k) => document.fonts.load(`${k.italic ? 'italic ' : ''}${k.weight || 400} 40px "${k.font}"`))); await document.fonts.ready; } catch (e) { /* sin tipografías extra */ }
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
    rec = startRecorder(canvas, audio.exportDest && audio.exportDest.stream, { bitrate: Math.min(bitrate, 12e6), fps: 30 });
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
    h('button', { class: 'btn block', onclick: newProject }, 'Proyecto nuevo (este se queda guardado)'),
    h('button', { class: 'btn block ghost', onclick: openProjectsList }, 'Mis proyectos guardados'),
  ]);
}

// Cambia a otro proyecto: guarda el actual, suelta sus medios y carga los del otro
async function switchTo(data) {
  pause();
  await flushSave();
  for (const m of state.media.values()) URL.revokeObjectURL(m.url);
  state.media.clear();
  cleanupVideos();
  if (data) {
    for (const r of data.media) {
      try { await createMedia(r.blob, r.id, { name: r.name, thumb: r.thumb, saved: true }); } catch (e) { /* medio perdido */ }
    }
    loadProject(data.project);
  } else {
    loadProject({ id: uid('p'), name: 'Mi vídeo', aspect: '9:16', w: 1080, h: 1920, fps: 30, bg: '#000000', clips: [] });
    await saveProject(state.project, state.media);
  }
  bus.emit('media');
  closeModal();
  applyPreviewSize();
  updateProjChip();
  updateEmpty();
  timeline.render();
  $('tcTotal').textContent = fmtTime(projectDuration());
  dirty = true;
}

async function newProject() {
  await switchTo(null);
  toast('Proyecto nuevo. El anterior sigue guardado en «Mis proyectos».', 3500);
}

const fmtDate = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function openProjectsList() {
  await flushSave();
  const list = await listProjects();
  const info = await storageInfo();
  const grid = h('div', { class: 'pj-grid' });
  if (!list.length) grid.append(h('p', { class: 'hint' }, 'Todavía no hay proyectos guardados.'));
  const ask = (title, value, ok) => {
    const inp = h('input', { type: 'text', value });
    openModal([h('h2', {}, title), h('div', { class: 'field' }, inp),
      h('button', { class: 'btn gold block', onclick: async () => { await ok(inp.value.trim()); } }, 'Aceptar'),
      h('button', { class: 'btn block ghost', onclick: openProjectsList }, 'Cancelar')]);
    setTimeout(() => inp.select(), 50);
  };
  for (const p of list) {
    const cur = p.id === state.project.id;
    const ar = p.aspect === '16:9' ? '16/9' : p.aspect === '1:1' ? '1/1' : p.aspect === '4:5' ? '4/5' : '9/16';
    const open = async () => {
      if (cur) { closeModal(); return; }
      toast('Abriendo…', 20000);
      const d = await openSavedProject(p.id);
      if (!d) { toast('No se pudo abrir este proyecto'); return; }
      await switchTo(d); toast('Proyecto abierto');
    };
    const card = h('div', { class: 'pj-card' + (cur ? ' cur' : '') },
      h('button', { class: 'pj-cover', onclick: open, style: p.thumb ? `background-image:url(${p.thumb})` : '' },
        p.thumb ? null : h('span', {}, 'Sin vista previa'),
        h('em', { class: 'pj-dur' }, fmtTime(p.dur || 0)),
        cur ? h('em', { class: 'pj-badge' }, 'Abierto') : null),
      h('div', { class: 'pj-info' }, h('b', {}, p.name || 'Sin nombre'), h('small', {}, `${p.aspect} · ${p.count || 0} clips · ${fmtDate(p.updated)}`)),
      h('div', { class: 'pj-acts' },
        h('button', { class: 'btn sm', onclick: open }, cur ? 'Seguir' : 'Abrir'),
        h('button', { class: 'btn sm', onclick: () => ask('Renombrar proyecto', p.name || '', async (n) => { if (n) { await renameProject(p.id, n); if (cur) { state.project.name = n; updateProjChip(); } } openProjectsList(); }) }, 'Renombrar'),
        h('button', { class: 'btn sm', onclick: async () => { await duplicateProject(p.id); openProjectsList(); } }, 'Duplicar'),
        cur ? null : h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`¿Borrar «${p.name}» de este dispositivo?`)) return; await deleteProject(p.id, state.media); openProjectsList(); } }, 'Borrar')));
    grid.append(card);
  }
  const sh = openModal([
    h('div', { class: 'pj-head' }, h('div', {}, h('h2', {}, 'Mis proyectos'),
      h('p', { class: 'sub' }, 'Se guardan solos en este dispositivo mientras editas.')),
      h('button', { class: 'btn gold', onclick: newProject }, '+ Nuevo proyecto')),
    grid,
    info && info.quota ? h('p', { class: 'hint' }, `Espacio usado: ${(info.used / 1048576).toFixed(0)} MB de ${(info.quota / 1048576).toFixed(0)} MB`) : null,
    h('button', { class: 'btn block ghost', onclick: closeModal }, 'Cerrar'),
  ].filter(Boolean));
  sh.classList.add('wide');
}

// ---------- Media: biblioteca de recursos propios ----------
let libTab = 'video';
const LIB_TABS = [['video', 'Vídeos', 'video/*'], ['audio', 'Audios', 'audio/*'], ['image', 'Imágenes', 'image/*']];
async function libImport(files) {
  toast(`Guardando ${files.length > 1 ? files.length + ' archivos' : 'archivo'}…`, 60000);
  let ok = 0;
  for (const f of files) {
    try {
      const id = uid('lib');
      const m = await createMedia(f, id);
      await libAdd({ id, name: m.name, kind: m.kind, blob: f, w: m.w, h: m.h, duration: m.duration, thumb: m.thumb, added: Date.now(), size: f.size });
      URL.revokeObjectURL(m.url); state.media.delete(id);
      libTab = m.kind; ok++;
    } catch (err) { toast('No se pudo guardar ' + f.name + ': ' + err.message, 5000); }
  }
  if (ok) toast(ok === 1 ? 'Guardado en la biblioteca' : `${ok} archivos guardados en la biblioteca`);
  openMedia();
}
async function libUse(rec, lane) {
  toast('Añadiendo…', 15000);
  const r = await libGet(rec.id);
  if (!r) { toast('No se encontró el archivo'); return; }
  const mid = rec.id;
  let m = state.media.get(mid);
  if (!m) m = await createMedia(new File([r.blob], r.name, { type: r.blob.type }), mid, { name: r.name, thumb: r.thumb });
  bus.emit('media');
  addMediaToTimeline(m, false, lane);
  closeModal();
}
async function openMedia() {
  const all = await libList();
  const list = all.filter((x) => x.kind === libTab);
  const seg = h('div', { class: 'lib-tabs' }, ...LIB_TABS.map(([k, n]) => h('button', { class: libTab === k ? 'on' : '', onclick: () => { libTab = k; openMedia(); } }, `${n} (${all.filter((x) => x.kind === k).length})`)));
  const grid = h('div', { class: 'pj-grid' });
  if (!list.length) grid.append(h('p', { class: 'hint', style: 'grid-column:1/-1' }, libTab === 'audio' ? 'Aquí guardas los audios que usas a menudo: música, efectos de sonido…' : libTab === 'image' ? 'Aquí guardas imágenes que usas a menudo: logotipos, fondos…' : 'Aquí guardas los vídeos que usas a menudo: pantallas verdes, fondos animados…'));
  for (const r of list) {
    const use = () => libUse(r, null);
    grid.append(h('div', { class: 'pj-card' },
      h('button', { class: 'pj-cover', onclick: use, style: r.thumb ? `background-image:url(${r.thumb})` : '' },
        r.thumb ? null : h('span', {}, r.kind === 'audio' ? 'Audio' : 'Sin vista previa'),
        r.kind !== 'image' && r.duration ? h('em', { class: 'pj-dur' }, fmtTime(r.duration)) : null),
      h('div', { class: 'pj-info' }, h('b', {}, r.name), h('small', {}, `${(r.size / 1048576).toFixed(1)} MB`)),
      h('div', { class: 'pj-acts' },
        h('button', { class: 'btn sm', onclick: use }, 'Usar'),
        r.kind === 'audio' ? null : h('button', { class: 'btn sm', onclick: () => libUse(r, 'overlay') }, 'Superponer'),
        h('button', { class: 'btn sm', onclick: () => { const inp = h('input', { type: 'text', value: r.name }); openModal([h('h2', {}, 'Renombrar'), h('div', { class: 'field' }, inp), h('button', { class: 'btn gold block', onclick: async () => { if (inp.value.trim()) await libRename(r.id, inp.value.trim()); openMedia(); } }, 'Aceptar'), h('button', { class: 'btn block ghost', onclick: openMedia }, 'Cancelar')]); } }, 'Renombrar'),
        h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`¿Quitar «${r.name}» de la biblioteca? Los proyectos que ya lo usan no se ven afectados.`)) return; await libDelete(r.id); openMedia(); } }, 'Quitar'))));
  }
  const fin = h('input', { type: 'file', multiple: true, accept: (LIB_TABS.find((t) => t[0] === libTab) || LIB_TABS[0])[2], style: 'display:none' });
  fin.onchange = () => { const f = [...fin.files]; if (f.length) libImport(f); };
  const sh = openModal([
    h('div', { class: 'pj-head' }, h('div', {}, h('h2', {}, 'Biblioteca'), h('p', { class: 'sub' }, 'Tus recursos a mano para cualquier proyecto.')),
      h('button', { class: 'btn gold', onclick: () => fin.click() }, '+ Añadir'), fin),
    seg, grid,
    h('button', { class: 'btn block ghost', onclick: closeModal }, 'Cerrar'),
  ]);
  sh.classList.add('wide');
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
  openXfade: (c) => { if (!state.sel.has(c.id) || state.sel.size > 1) select(c.id); panels.open('xfade'); },
  audio, pause, openSubtitles: () => openSubtitles(app), openSubEditor: () => openSubEditor(app), subCount: () => subClips().length,
  seek, pickFiles, replaceClip, addMediaToTimeline: (m, q, lane) => addMediaToTimeline(m, q, lane), addText, addFx, recordVoice, openProject,
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
  clearSpectrumCache();
  $('tcTotal').textContent = fmtTime(projectDuration());
  if (e && e.aspect) applyPreviewSize();
  if (e && e.structural) { cleanupVideos(); updateEmpty(); }
  if (state.playing && e && (e.structural || e.timing)) audio.schedule(state.project, state.media, state.time);
});
bus.on('time', () => { $('tcNow').textContent = fmtTime(state.time); });
bus.on('fontloaded', () => (dirty = true));
bus.on('frames', () => timeline.render());
const setSaveState = (ok) => { const d = $('saveDot'); if (!d) return; d.className = 'save-dot ' + (ok ? 'ok' : 'pend'); d.title = ok ? 'Guardado' : 'Guardando…'; };
let saveTimer = null, saving = Promise.resolve(), warnedBig = false;
let appReady = false; // hasta que se recupera el proyecto guardado no se guarda nada (evita pisarlo con uno vacío)
function doSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!appReady) return saving;
  saving = saving.then(async () => {
    const r = await saveProject(state.project, state.media);
    setSaveState(r.ok);
    if (r.failed.length && !warnedBig) {
      warnedBig = true;
      toast('«' + r.failed[0] + '» pesa demasiado para guardarlo en este dispositivo: el proyecto se guarda, pero ese archivo tendrás que volver a importarlo al reabrir.', 9000);
    }
  }).catch(() => {});
  return saving;
}
const flushSave = () => doSave();
bus.on('commit', () => {
  updateUndo();
  setSaveState(false);
  $('tcTotal').textContent = fmtTime(projectDuration());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 700);
});
// al salir o cambiar de app se guarda al instante, sin esperar
document.addEventListener('visibilitychange', () => { if (document.hidden) doSave(); });
window.addEventListener('pagehide', () => doSave());

$('btnPlay').onclick = () => (state.playing ? pause() : play());
$('btnToStart').onclick = () => seek(0);
$('btnUndo').onclick = () => { pause(); undo(); };
$('btnRedo').onclick = () => { pause(); redo(); };
$('btnExport').onclick = openExport;
$('btnProjects').onclick = () => { pause(); openProjectsList(); };
$('btnMedia').onclick = () => { pause(); openMedia(); };
$('btnProject').onclick = openProject;
$('btnHintImport').onclick = pickFiles;
$('btnFull').onclick = () => {
  const el = $('canvasWrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
};
// guías de zonas seguras (no se exportan)
const SAFE = [
  { n: 'Guías', t: 0, b: 0, l: 0, r: 0 },
  { n: 'Instagram', t: 0.14, b: 0.25, l: 0.06, r: 0.06, side: 0.14 },
  { n: 'TikTok', t: 0.10, b: 0.25, l: 0.05, r: 0.05, side: 0.17 },
  { n: 'Shorts', t: 0.08, b: 0.20, l: 0.05, r: 0.14 },
];
let safeMode = -1;
$('btnSafe').onclick = () => {
  safeMode = (safeMode + 2) % (SAFE.length + 1) - 1;
  const el = $('safeLayer');
  if (safeMode < 0) { el.hidden = true; $('btnSafe').textContent = 'Guías'; return; }
  const z = SAFE[safeMode];
  el.hidden = false;
  el.innerHTML = '';
  el.append(h('i', { class: 'sz-v' }), h('i', { class: 'sz-h' }));
  if (z.t || z.b) {
    const box = h('i', { class: 'sz-box', style: `top:${z.t * 100}%;bottom:${z.b * 100}%;left:${z.l * 100}%;right:${z.r * 100}%` });
    el.append(box);
    if (z.side) el.append(h('i', { class: 'sz-side', style: `top:${z.t * 100 + 30}%;bottom:${z.b * 100}%;right:0;width:${z.side * 100}%` }));
  }
  $('btnSafe').textContent = z.n;
  toast(z.t ? `Zona segura de ${z.n}: mantén texto e imágenes importantes dentro del recuadro` : 'Guías de centro activadas', 2800);
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
  if (exporting || offlineBusy || !$('modal').hidden) return;
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
  askPersistent();
  const saved = await loadSaved();
  if (saved && saved.project && saved.project.clips && saved.project.clips.length) {
    toast('Recuperando tu proyecto…', 30000);
    for (const r of saved.media) {
      try { await createMedia(r.blob, r.id, { name: r.name, thumb: r.thumb, saved: true }); } catch (e) { /* medio perdido */ }
    }
    const p = saved.project;
    const before = p.clips.length;
    const lost = p.clips.filter((c) => c.media && !state.media.has(c.media)).length;
    loadProject(p);
    bus.emit('media');
    toast(lost ? 'Proyecto recuperado, pero faltan ' + lost + ' clips cuyo archivo no se pudo guardar. Se conservan en la línea de tiempo: pulsa «Sustituir» e importa de nuevo el vídeo.' : 'Proyecto recuperado ✓', lost ? 9000 : 2500);
  } else if (saved && saved.project) {
    loadProject(saved.project);
  }
  updateProjChip();
  updateEmpty();
  timeline.render();
  $('tcTotal').textContent = fmtTime(projectDuration());
  dirty = true;
  appReady = true;
})();

// acceso para pruebas
window.__editor = { state, app, play, pause, seek, importFiles, renderer, timeline, panels };

// Toque con 2 dedos = deshacer, con 3 dedos = rehacer (toque corto, sin mover los dedos)
{
  let g = null;
  const skip = (t) => { const tag = ((t && t.tagName) || '').toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select'; };
  document.addEventListener('touchstart', (e) => {
    if (skip(e.target)) { g = null; return; }
    const pts = [...e.touches].map((t) => [t.clientX, t.clientY]);
    if (!g || e.touches.length === 1) g = { t0: performance.now(), max: e.touches.length, start: pts, bad: false };
    g.max = Math.max(g.max, e.touches.length);
    if (e.touches.length > 3) g.bad = true;
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    if (!g.moved) g.moved = true;
    const t = e.touches[0];
    if (t && g.start[0] && Math.hypot(t.clientX - g.start[0][0], t.clientY - g.start[0][1]) > 14) g.bad = true;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', (e) => {
    if (!g || e.touches.length > 0) return;
    const ok = !g.bad && performance.now() - g.t0 < 380;
    const n = g.max; g = null;
    if (!ok || (n !== 2 && n !== 3)) return;
    pause();
    if (n === 2) { if (canUndo()) { undo(); toast('Deshecho'); } else toast('Nada que deshacer'); }
    else if (canRedo()) { redo(); toast('Rehecho'); } else toast('Nada que rehacer');
  }, { passive: true, capture: true });
  document.addEventListener('touchcancel', () => { g = null; }, { passive: true, capture: true });
}

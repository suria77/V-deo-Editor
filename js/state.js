// Estado del proyecto, historial (deshacer/rehacer) y utilidades de clips.
import { ADJ_DEFAULT, PARTICLES, POSTFX } from './presets.js';
import { splitKf } from './kf.js';

let _uid = 0;
export const uid = (p = 'c') => p + Date.now().toString(36) + (_uid++).toString(36) + Math.floor(Math.random() * 1e4).toString(36);

export const LANES = ['overlay', 'video', 'text', 'fx', 'audio'];
export const LANE_NAMES = { overlay: 'Superpuesto', video: 'Vídeo', text: 'Texto', fx: 'Efectos', audio: 'Audio' };

class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ||= []).push(f); return () => (this.h[e] = this.h[e].filter((x) => x !== f)); }
  emit(e, a) { (this.h[e] || []).forEach((f) => f(a)); }
}

export const bus = new Emitter();

export const state = {
  project: { name: 'Mi vídeo', aspect: '9:16', w: 1080, h: 1920, fps: 30, bg: '#000000', clips: [] },
  media: new Map(), // id -> {id,name,kind,blob,url,w,h,duration,el,buffer,thumb,peaks}
  selection: null, // clip principal (el último tocado)
  sel: new Set(), // todos los clips seleccionados
  selectMode: false,
  time: 0,
  playing: false,
};

// ---------- Historial ----------
const undoStack = [];
const redoStack = [];
let lastSnap = null;
const snap = () => JSON.stringify(state.project);

export function resetHistory() {
  undoStack.length = 0; redoStack.length = 0; lastSnap = snap();
}
export function commit() {
  const s = snap();
  if (s === lastSnap) return;
  undoStack.push(lastSnap);
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  lastSnap = s;
  bus.emit('commit');
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastSnap);
  lastSnap = undoStack.pop();
  state.project = JSON.parse(lastSnap);
  fixSelection();
  bus.emit('change', { structural: true });
  bus.emit('commit');
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastSnap);
  lastSnap = redoStack.pop();
  state.project = JSON.parse(lastSnap);
  fixSelection();
  bus.emit('change', { structural: true });
  bus.emit('commit');
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
function fixSelection() {
  for (const id of [...state.sel]) if (!getClip(id)) state.sel.delete(id);
  if (state.selection && !getClip(state.selection)) state.selection = [...state.sel].pop() || null;
  bus.emit('select');
}

// ---------- Clips ----------
export const getClip = (id) => state.project.clips.find((c) => c.id === id);
export const selectedClip = () => (state.selection ? getClip(state.selection) : null);

export function select(id) {
  state.selection = id;
  state.sel = id ? new Set([id]) : new Set();
  bus.emit('select');
}
export function toggleSel(id) {
  if (state.sel.has(id)) {
    state.sel.delete(id);
    if (state.selection === id) state.selection = [...state.sel].pop() || null;
  } else {
    state.sel.add(id);
    state.selection = id;
  }
  bus.emit('select');
}
export function selectIds(ids) {
  state.sel = new Set(ids);
  state.selection = ids.length ? ids[ids.length - 1] : null;
  bus.emit('select');
}
export const selectedClips = () => state.project.clips.filter((c) => state.sel.has(c.id));
export function setSelectMode(on) {
  state.selectMode = !!on;
  bus.emit('selectmode');
}

export function projectDuration() {
  let d = 0;
  for (const c of state.project.clips) d = Math.max(d, c.start + c.dur);
  return d;
}

export function defaultTf() {
  return { x: 0, y: 0, scale: 1, rot: 0, opacity: 1, flipX: false, flipY: false, fit: 'cover', bgBlur: true };
}

export function makeVisualClip(media, start, lane = 'video') {
  const isVideo = media.kind === 'video';
  return {
    id: uid(), type: isVideo ? 'video' : 'image', lane, media: media.id,
    start, dur: isVideo ? Math.min(media.duration || 5, 600) : 4, in: 0, speed: 1,
    volume: 1, muted: false, afadeIn: 0, afadeOut: 0,
    tf: defaultTf(), crop: { l: 0, r: 0, t: 0, b: 0 }, mask: { type: 'none', size: 1, feather: 0.15 },
    adj: { ...ADJ_DEFAULT }, filter: 'none', filterAmt: 1,
    chroma: { on: false, color: '#00ff00', sim: 0.3, smooth: 0.12 },
    blend: 'normal', motion: { type: 'none', amount: 0.5 },
    transIn: { type: 'none', dur: 0.5 }, transOut: { type: 'none', dur: 0.5 },
  };
}

export function makeAudioClip(media, start) {
  return {
    id: uid(), type: 'audio', lane: 'audio', media: media.id, start,
    dur: Math.min(media.duration || 5, 600), in: 0, speed: 1, volume: 1, afadeIn: 0, afadeOut: 0,
  };
}

export function makeTextClip(start, preset = {}) {
  return {
    id: uid(), type: 'text', lane: 'text', start, dur: 3,
    text: 'Tu texto aquí', opacity: 1, font: 'Montserrat', weight: 900, italic: false, size: 0.07, upper: false,
    color: '#ffffff', color2: '', stroke: { w: 0, color: '#000000' },
    shadow: { blur: 0.4, color: '#000000' }, bg: { on: false, color: '#000000', alpha: 0.5 },
    x: 0, y: 0, align: 'center', spacing: 0, lineHeight: 1.15, width: 0.88, rot: 0,
    inAnim: { type: 'pop', dur: 0.5 }, outAnim: { type: 'fade', dur: 0.4 }, loop: { type: 'none', amount: 0.5 },
    ...structuredClone(preset),
  };
}

export function makeFxClip(def, start, kind = 'particles') {
  const base = kind === 'particles' ? PARTICLES.find((p) => p.id === def) : POSTFX.find((p) => p.id === def);
  return {
    id: uid(), type: 'fx', lane: 'fx', kind, fx: def, start, dur: 4,
    intensity: base.intensity ?? 0.6, speed: base.speed ?? 1, size: base.size ?? 1,
    color: base.color || '#ffffff', fade: 0.6, seed: Math.floor(Math.random() * 1000),
  };
}

export function addClip(c) {
  state.project.clips.push(c);
  bus.emit('change', { structural: true });
  commit();
  return c;
}

export function removeClip(id) {
  const i = state.project.clips.findIndex((c) => c.id === id);
  if (i < 0) return;
  state.project.clips.splice(i, 1);
  state.sel.delete(id);
  if (state.selection === id) state.selection = [...state.sel].pop() || null;
  bus.emit('select');
  bus.emit('change', { structural: true });
  commit();
}

export function removeClips(ids) {
  const set = new Set(ids);
  state.project.clips = state.project.clips.filter((c) => !set.has(c.id));
  for (const id of set) state.sel.delete(id);
  state.selection = [...state.sel].pop() || null;
  bus.emit('select');
  bus.emit('change', { structural: true });
  commit();
}

// Duplica un grupo conservando las distancias entre clips; la copia va justo después del grupo
export function duplicateClips(ids) {
  const cs = state.project.clips.filter((c) => ids.includes(c.id));
  if (!cs.length) return [];
  const t0 = Math.min(...cs.map((c) => c.start));
  const t1 = Math.max(...cs.map((c) => c.start + c.dur));
  const out = cs.map((c) => { const n = structuredClone(c); n.id = uid(); n.start = c.start - t0 + t1; return n; });
  state.project.clips.push(...out);
  selectIds(out.map((c) => c.id));
  bus.emit('change', { structural: true });
  commit();
  return out;
}

export function splitClips(ids, t) {
  const out = [];
  for (const id of ids) {
    const c = getClip(id);
    if (!c || t <= c.start + 0.05 || t >= c.start + c.dur - 0.05) continue;
    const n = structuredClone(c);
    n.id = uid();
    const left = t - c.start;
    n.start = t; n.dur = c.dur - left; c.dur = left;
    if ('in' in c) n.in = c.in + left * (c.speed || 1);
    if (n.transIn) n.transIn = { type: 'none', dur: 0.5 };
    if (c.transOut) c.transOut = { type: 'none', dur: 0.5 };
    if (n.afadeIn) n.afadeIn = 0;
    if (c.afadeOut) c.afadeOut = 0;
    if (c.words) { splitWords(c, n, left); }
    if (c.kf) splitKf(c, n, left);
    state.project.clips.push(n);
    out.push(n.id);
  }
  if (out.length) {
    selectIds(out);
    bus.emit('change', { structural: true });
    commit();
  }
  return out;
}

function splitWords(a, b, left) {
  const all = a.words;
  a.words = all.filter((w) => w.s < left);
  b.words = all.filter((w) => w.s >= left).map((w) => ({ ...w, s: w.s - left, e: w.e - left }));
  const na = a.words.length;
  const toks = a.text.split(/\s+/).filter(Boolean);
  a.text = toks.slice(0, na).join(' ');
  b.text = toks.slice(na).join(' ');
}

export function duplicateClip(id) {
  const c = getClip(id);
  if (!c) return null;
  const n = structuredClone(c);
  n.id = uid();
  n.start = c.start + c.dur;
  state.project.clips.push(n);
  state.selection = n.id;
  bus.emit('select');
  bus.emit('change', { structural: true });
  commit();
  return n;
}

export function splitClip(id, t) {
  const c = getClip(id);
  if (!c || t <= c.start + 0.05 || t >= c.start + c.dur - 0.05) return null;
  const n = structuredClone(c);
  n.id = uid();
  const left = t - c.start;
  n.start = t;
  n.dur = c.dur - left;
  c.dur = left;
  if ('in' in c) n.in = c.in + left * (c.speed || 1);
  if (n.transIn) n.transIn = { type: 'none', dur: 0.5 };
  if (c.transOut) c.transOut = { type: 'none', dur: 0.5 };
  if (n.afadeIn) n.afadeIn = 0;
  if (c.afadeOut) c.afadeOut = 0;
  if (c.kf) splitKf(c, n, left);
  state.project.clips.push(n);
  state.selection = n.id;
  bus.emit('select');
  bus.emit('change', { structural: true });
  commit();
  return n;
}

export function setAspect(key, dims) {
  state.project.aspect = key;
  state.project.w = dims.w;
  state.project.h = dims.h;
  bus.emit('change', { structural: true, aspect: true });
  commit();
}

export function loadProject(p) {
  state.project = p;
  state.selection = null;
  state.sel = new Set();
  state.time = 0;
  resetHistory();
  bus.emit('select');
  bus.emit('change', { structural: true, aspect: true });
}

// Qué clips están activos en el instante t
export function activeClips(t) {
  return state.project.clips.filter((c) => t >= c.start - 1e-6 && t < c.start + c.dur);
}

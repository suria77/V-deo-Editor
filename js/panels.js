// Barra de herramientas inferior (estilo CapCut/DaVinci) + panel de la herramienta elegida.
import { state, bus, commit, selectedClip, selectedClips, removeClips, rippleRemove, trimAt, detachAudio, duplicateClips, splitClips, select } from './state.js';
import { h, slider, select as selectCtl, toggle, color, chips, section, fmtTime, toast } from './ui.js';
import {
  ADJ_CONTROLS, ADJ_DEFAULT, FILTERS, MOTIONS, TRANSITIONS, BLENDS, MASKS, FONTS,
  TEXT_IN, TEXT_OUT, TEXT_LOOP, TEXT_STYLES, PARTICLES, POSTFX,
} from './presets.js';
import { icon } from './icons.js';
import { SPEC_STYLES } from './spectrum.js';
import { thumb } from './thumbs.js';
// tarjeta con miniatura renderizada (se rellena cuando está lista)
function thumbCard(kind, id, name, onclick, on) {
  const im = h('span', { class: 'th-img' });
  const b = h('button', { class: 'card th-card' + (on ? ' on' : ''), onclick }, im, h('small', {}, name));
  thumb(kind, id, (u) => { if (u) im.style.backgroundImage = `url(${u})`; });
  return b;
}
import { XFADES, nextAdjacent } from './xfade.js';
import { layerInfo, moveLayer, swapContent } from './layers.js';
import { propsFor, valueAt, setValue, setKf, removeKf, kfAt, hasKf, kfTimes, anyKfAt, toggleAllKf, anyKf } from './kf.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtNum = (v, step) => Number(v).toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

// Herramientas cuando no hay nada seleccionado
// Selector de fuentes: cada nombre escrito con su propia letra, agrupadas por estilo
function fontPicker(cur, onPick) {
  const wrap = h('div', { class: 'field' });
  const curF = FONTS.find((f) => f.f === cur);
  wrap.append(h('label', {}, 'Tipo de letra', h('output', {}, curF ? curF.n : cur)));
  const box = h('div', { class: 'font-picker' });
  const cats = [...new Set(FONTS.map((f) => f.cat))];
  for (const cat of cats) {
    box.append(h('div', { class: 'font-cat' }, cat));
    const grid = h('div', { class: 'font-grid' });
    for (const f of FONTS.filter((x) => x.cat === cat)) {
      const btn = h('button', { class: 'font-btn' + (f.f === cur ? ' on' : ''), style: `font-family:"${f.f}", serif`, title: f.n }, f.n);
      btn.addEventListener('click', () => {
        box.querySelectorAll('.font-btn.on').forEach((x) => x.classList.remove('on'));
        btn.classList.add('on');
        wrap.querySelector('output').textContent = f.n;
        onPick(f.f);
      });
      grid.append(btn);
    }
    box.append(grid);
  }
  wrap.append(box);
  requestAnimationFrame(() => { const on = box.querySelector('.font-btn.on'); if (on) box.scrollTop = Math.max(0, on.offsetTop - box.offsetTop - 60); });
  return wrap;
}

const MAIN_TOOLS = [
  { id: 'media', n: 'Medios', i: 'media' },
  { id: 'audio', n: 'Audio', i: 'audio' },
  { id: 'text', n: 'Texto', i: 'text' },
  { id: 'fx', n: 'Efectos', i: 'fx' },
  { id: 'overlay', n: 'Superposición', i: 'overlay' },
  { id: 'subs', n: 'Subtítulos', i: 'subs' },
  { id: 'filter', n: 'Filtros', i: 'filters', clip: true },
  { id: 'adj', n: 'Ajustar', i: 'adjust', clip: true },
  { id: 'aspect', n: 'Formato', i: 'aspect', act: 'aspect' },
  { id: 'bg', n: 'Fondo', i: 'bg' },
];

// Herramientas de cada tipo de clip ( act = acción directa; el resto abre su sección )
const A = (id, n, i, extra = {}) => ({ id, n, i, ...extra });
const CLIP_TOOLS = {
  video: [A('split', 'Dividir', 'split', { act: 'split' }), A('speed', 'Velocidad', 'speed'), A('vol', 'Volumen', 'volume'), A('kf', 'Keyframes', 'kf', { cls: 'kft' }),
    A('pos', 'Posición', 'pos'), A('opac', 'Opacidad', 'opacity'), A('filter', 'Filtros', 'filters'), A('adj', 'Ajustar', 'adjust'),
    A('motion', 'Movimiento', 'motion'), A('xfade', 'Transición', 'trans'), A('trans', 'Entrada/salida', 'anim'), A('mask', 'Máscara', 'mask'), A('key', 'Croma', 'chroma'),
    A('layer', 'Capas', 'swap'), A('replace', 'Sustituir', 'replace', { act: 'replace' }),
    A('dup', 'Duplicar', 'dup', { act: 'dup' }), A('trl', 'Recortar ◀', 'split', { act: 'trl' }), A('trr', 'Recortar ▶', 'split', { act: 'trr' }), A('det', 'Separar audio', 'audio', { act: 'det' }), A('rdel', 'Borrar y cerrar', 'del', { act: 'rdel' }), A('del', 'Eliminar', 'del', { act: 'del', cls: 'danger' }), A('all', 'Todo', 'all')],
  text: [A('txt', 'Editar', 'edit'), A('tstyle', 'Estilo', 'style'), A('tpos', 'Posición', 'pos'), A('tanim', 'Animación', 'anim'), A('kf', 'Keyframes', 'kf', { cls: 'kft' }),
    A('split', 'Dividir', 'split', { act: 'split' }), A('dup', 'Duplicar', 'dup', { act: 'dup' }), A('del', 'Eliminar', 'del', { act: 'del', cls: 'danger' }), A('all', 'Todo', 'all')],
  fx: [A('fxp', 'Ajustes', 'adjust'), A('replace', 'Sustituir', 'replace', { act: 'replace' }), A('kf', 'Keyframes', 'kf', { cls: 'kft' }), A('split', 'Dividir', 'split', { act: 'split' }), A('dup', 'Duplicar', 'dup', { act: 'dup' }), A('del', 'Eliminar', 'del', { act: 'del', cls: 'danger' })],
  audio: [A('vol', 'Volumen', 'volume'), A('replace', 'Sustituir', 'replace', { act: 'replace' }), A('speed', 'Velocidad', 'speed'), A('kf', 'Keyframes', 'kf', { cls: 'kft' }), A('split', 'Dividir', 'split', { act: 'split' }),
    A('dup', 'Duplicar', 'dup', { act: 'dup' }), A('trl', 'Recortar ◀', 'split', { act: 'trl' }), A('trr', 'Recortar ▶', 'split', { act: 'trr' }), A('rdel', 'Borrar y cerrar', 'del', { act: 'rdel' }), A('del', 'Eliminar', 'del', { act: 'del', cls: 'danger' })],
};
CLIP_TOOLS.image = CLIP_TOOLS.video.filter((t) => t.id !== 'speed' && t.id !== 'vol');
const DEFAULT_SEC = { video: 'pos', image: 'pos', text: 'txt', fx: 'fxp', audio: 'vol' };
const MAIN_IDS = new Set(MAIN_TOOLS.map((t) => t.id).filter((id) => id !== 'filter' && id !== 'adj'));
const TITLES = { all: 'Todos los ajustes', kf: 'Keyframes', fxp: 'Efecto', txt: 'Texto', tstyle: 'Estilo del texto', tpos: 'Posición', tanim: 'Animación', pos: 'Posición y tamaño', opac: 'Opacidad y fusión', filter: 'Filtros', adj: 'Ajustar color', motion: 'Movimiento', trans: 'Entrada y salida', xfade: 'Transición con el siguiente clip', mask: 'Recorte y máscara', key: 'Pantalla verde (croma)', speed: 'Velocidad', vol: 'Volumen y sonido', layer: 'Capas: qué va encima' };

export class Panels {
  constructor(app) {
    this.app = app;
    this.tool = 'media';
    this.root = document.getElementById('app');
    this.body = document.getElementById('tabBody');
    this.titleEl = document.getElementById('panelTitle');
    this.tb = document.getElementById('toolbar');
    this.refreshers = [];
    this.wideMq = window.matchMedia('(min-width: 1000px)');
    document.getElementById('panelClose').addEventListener('click', () => this.close());
    if (!this.wideMq.matches) this.root.classList.remove('panel-open');
    this.wideMq.addEventListener && this.wideMq.addEventListener('change', () => { if (this.wideMq.matches && !this.isOpen()) this.open(this.tool); });

    bus.on('select', () => this.onSelect());
    bus.on('selectmode', () => { if (this.isClipTool()) this.render(); });
    bus.on('change', (e) => {
      if (!this.isOpen()) return;
      if (e && (e.structural || e.timing) && this.isClipTool() && !(e && e.keepPanel)) this.render();
      else if (e && e.structural && (this.tool === 'media' || this.tool === 'audio' || this.tool === 'overlay' || this.tool === 'subs')) this.render();
    });
    bus.on('media', () => { if (this.isOpen() && (this.tool === 'media' || this.tool === 'audio' || this.tool === 'overlay')) this.render(); });
    let raf = 0;
    bus.on('time', () => { if (raf || !this.refreshers.length || !this.isOpen()) return; raf = requestAnimationFrame(() => { raf = 0; for (const f of this.refreshers) f(); }); });
    bus.on('kf', () => { for (const f of this.refreshers) f(); });
    this.renderToolbar();
    this.render();
  }

  isOpen() { return this.root.classList.contains('panel-open'); }
  isClipTool() { return !MAIN_IDS.has(this.tool); }

  open(tool) {
    this.tool = tool;
    this.root.classList.add('panel-open');
    this.render();
    this.renderToolbar();
  }
  close() {
    this.root.classList.remove('panel-open');
    this.refreshers = [];
    this.renderToolbar();
  }
  // compatibilidad con el resto de la app
  show(tool) { this.open(tool === 'inspect' ? this.defaultClipSec() : tool); }

  defaultClipSec() { const c = selectedClip(); return c ? DEFAULT_SEC[c.type] || 'all' : 'media'; }

  onSelect() {
    const c = selectedClip();
    this.renderToolbar();
    if (state.selectMode) { if (this.isOpen() && this.isClipTool()) this.render(); return; }
    if (c) {
      const tools = CLIP_TOOLS[c.type] || [];
      const valid = this.tool === 'all' || tools.some((t) => t.id === this.tool && !t.act);
      if (this.isOpen() && this.isClipTool() && valid) this.render();
      else if (this.wideMq.matches) this.open(this.defaultClipSec());
      else if (this.isOpen() && this.isClipTool()) this.open(this.defaultClipSec());
    } else if (this.isClipTool()) {
      if (this.wideMq.matches) this.open('media'); else this.close();
    }
  }

  // ---------------- barra inferior ----------------
  renderToolbar() {
    const tb = this.tb;
    tb.innerHTML = '';
    const c = selectedClip();
    const open = this.isOpen();
    const btn = (t, onclick) => {
      const b = h('button', { class: 'tool' + (t.cls ? ' ' + t.cls : '') + (open && this.tool === t.id && !t.act ? ' on' : ''), title: t.n }, icon(t.i), h('span', {}, t.n));
      b.addEventListener('click', onclick);
      return b;
    };
    if (!c) {
      for (const t of MAIN_TOOLS) tb.append(btn(t, () => this.runMain(t)));
      return;
    }
    const back = h('button', { class: 'tool back', title: 'Volver' }, icon('back'), h('span', {}, 'Volver'));
    back.addEventListener('click', () => { state.selection = null; state.sel.clear(); bus.emit('select'); });
    tb.append(back);
    for (const t of CLIP_TOOLS[c.type] || []) tb.append(btn(t, () => this.runClip(t)));
  }

  runMain(t) {
    if (t.act === 'aspect') { this.app.openProject(); return; }
    if (t.clip) {
      // Filtros / Ajustar: actúan sobre el clip de vídeo que hay bajo el cabezal
      const k = state.project.clips.find((x) => (x.type === 'video' || x.type === 'image') && x.lane === 'video' && state.time >= x.start && state.time < x.start + x.dur)
        || state.project.clips.find((x) => x.type === 'video' || x.type === 'image');
      if (!k) { toast('Añade primero un vídeo o una foto'); return; }
      select(k.id);
      this.open(t.id);
      return;
    }
    if (this.isOpen() && this.tool === t.id && !this.wideMq.matches) { this.close(); return; }
    this.open(t.id);
  }

  runClip(t) {
    const ids = [...state.sel];
    if (t.act === 'split') { if (!splitClips(ids, state.time).length) toast('Coloca el cabezal dentro del clip para dividirlo'); return; }
    if (t.act === 'dup') { duplicateClips(ids); return; }
    if (t.act === 'trl' || t.act === 'trr') { if (!trimAt(ids, state.time, t.act === 'trl' ? 'l' : 'r')) toast('Coloca el cabezal dentro del clip para recortar'); return; }
    if (t.act === 'rdel') { rippleRemove(ids); return; }
    if (t.act === 'det') { const id = detachAudio(ids[0], state.media); toast(id ? 'Audio separado en su propia pista' : 'Este vídeo no tiene audio que separar'); return; }
    if (t.act === 'del') { removeClips(ids); return; }
    if (t.act === 'replace') { const c = selectedClip(); if (c) this.app.replaceClip(c); return; }
    if (this.isOpen() && this.tool === t.id && !this.wideMq.matches) { this.close(); return; }
    this.open(t.id);
  }

  render() {
    const st = this.body.scrollTop;
    const prevTool = this._lastTool;
    this.body.innerHTML = '';
    this.body.classList.remove('solo');
    this.refreshers = [];
    const c = selectedClip();
    if (this.isClipTool() && !c) this.tool = 'media';
    const main = { media: this.mediaTab, audio: this.audioTab, text: this.textTab, fx: this.fxTab, overlay: this.overlayTab, subs: this.subsTab, bg: this.bgTab }[this.tool];
    if (main) {
      this.titleEl.textContent = (MAIN_TOOLS.find((t) => t.id === this.tool) || {}).n || '';
      main.call(this);
    } else {
      this.titleEl.textContent = TITLES[this.tool] || 'Ajustes';
      this.inspectTab(this.tool);
    }
    if (prevTool === this.tool) this.body.scrollTop = st;
    this._lastTool = this.tool;
  }

  // ---------------- MEDIOS ----------------
  mediaGrid(list, onPick) {
    const g = h('div', { class: 'grid' });
    for (const m of list) {
      const th = h('div', { class: 'th', style: m.thumb ? `background-image:url(${m.thumb})` : 'background:linear-gradient(135deg,#4d5866,#3b4250)' }, m.thumb ? '' : (m.kind === 'audio' ? '🎵' : '🎞️'));
      g.append(h('button', { class: 'card media-card', onclick: () => onPick(m) },
        th, h('div', { class: 'nm' }, m.name), h('span', { class: 'add' }, '+'),
        m.duration ? h('span', { class: 'dur' }, fmtTime(m.duration, false)) : null));
    }
    return g;
  }

  mediaTab() {
    const b = this.body;
    b.append(h('div', { class: 'row-btns' },
      h('button', { class: 'btn accent', onclick: () => this.app.pickFiles() }, '+ Importar'),
      h('button', { class: 'btn', onclick: () => this.app.recordVoice() }, '🎙️ Grabar voz')));
    const list = [...state.media.values()];
    if (!list.length) {
      b.append(h('p', { class: 'hint' }, 'Importa vídeos, fotos o música desde tu iPad o tu ordenador. Toca una miniatura para añadirla a la línea de tiempo.'));
      return;
    }
    b.append(h('p', { class: 'hint' }, 'Toca para añadir: los vídeos y fotos van al final de la pista principal; el audio, donde está el cabezal.'));
    b.append(this.mediaGrid(list, (m) => this.app.addMediaToTimeline(m)));
  }

  audioTab() {
    const b = this.body;
    b.append(h('div', { class: 'row-btns' },
      h('button', { class: 'btn accent', onclick: () => this.app.pickFiles({ accept: 'audio/*,.mp3,.m4a,.wav,.aac,.ogg' }) }, '+ Música o sonido'),
      h('button', { class: 'btn', onclick: () => this.app.recordVoice() }, '🎙️ Grabar voz')));
    const list = [...state.media.values()].filter((m) => m.kind === 'audio');
    if (list.length) {
      b.append(h('p', { class: 'hint' }, 'Toca para ponerlo donde está el cabezal:'));
      b.append(this.mediaGrid(list, (m) => this.app.addMediaToTimeline(m)));
    }
    b.append(h('p', { class: 'hint', style: 'margin-top:14px' }, '💡 Toca un clip de audio (o de vídeo) en la línea de tiempo y usa «Volumen» o «Keyframes» para subir y bajar el sonido a lo largo del tiempo.'));
  }

  overlayTab() {
    const b = this.body;
    b.append(h('button', { class: 'btn accent block', onclick: () => this.app.pickFiles({ accept: 'video/*,image/*', lane: 'overlay' }) }, '+ Importar para superponer'));
    b.append(h('p', { class: 'hint', style: 'margin-top:12px' }, 'Lo que añadas aquí se pone encima del vídeo principal, donde está el cabezal: imagen en imagen, pantalla verde, luces, fuego sobre negro…'));
    const list = [...state.media.values()].filter((m) => m.kind !== 'audio');
    if (list.length) b.append(this.mediaGrid(list, (m) => this.app.addMediaToTimeline(m, false, 'overlay')));
  }

  subsTab() {
    const b = this.body;
    b.append(h('button', { class: 'btn accent block', style: 'margin-bottom:10px', onclick: () => this.app.openSubtitles() }, '✨ Crear subtítulos automáticos'));
    const n = this.app.subCount ? this.app.subCount() : 0;
    b.append(h('button', { class: 'btn block', onclick: () => this.app.openSubEditor() }, n ? `✏️ Revisar subtítulos (${n})` : '📄 Importar un archivo .srt'));
    b.append(h('p', { class: 'hint', style: 'margin-top:14px' }, 'La voz se convierte en texto en tu propio dispositivo. Luego puedes corregir cada línea, y cambiar el estilo tocando un subtítulo y eligiendo «Estilo».'));
  }

  bgTab() { this.projectFields(this.body); }

  // ---------------- TEXTO ----------------
  textTab() {
    const b = this.body;
    b.append(h('button', { class: 'btn accent block', onclick: () => this.app.addText({}) }, '+ Añadir texto'));
    b.append(h('button', { class: 'btn block', style: 'margin-top:10px', onclick: () => this.open('subs') }, '💬 Subtítulos automáticos'));
    b.append(h('p', { class: 'hint', style: 'margin-top:14px' }, 'O elige un estilo ya preparado (con su animación):'));
    const g = h('div', { class: 'grid' });
    for (const s of TEXT_STYLES) g.append(h('button', { class: 'card style-card', onclick: () => this.app.addText(s.p) }, h('span', { style: s.css }, 'Aa'), h('small', {}, s.n)));
    b.append(g);
  }

  // ---------------- EFECTOS ----------------
  fxTab() {
    const b = this.body;
    if (!this.fxSeg) this.fxSeg = 'particles';
    const seg = h('div', { class: 'seg' });
    const mk = (id, n) => h('button', { class: this.fxSeg === id ? 'on' : '', onclick: () => { this.fxSeg = id; this.render(); } }, n);
    seg.append(mk('particles', 'Luces'), mk('post', 'Imagen'), mk('spectrum', 'Espectro'));
    b.append(seg);
    if (this.fxSeg === 'spectrum') {
      b.append(h('p', { class: 'hint' }, 'Visualizador del audio de tu proyecto: se mueve con la música. Elige un estilo y luego ajusta color, forma y tamaño.'));
      const g = h('div', { class: 'grid' });
      for (const d of SPEC_STYLES) g.append(h('button', { class: 'card txt', onclick: () => this.app.addFx(d.id, 'spectrum') }, d.n));
      b.append(g);
      return;
    }
    const isP = this.fxSeg === 'particles';
    b.append(h('p', { class: 'hint' }, isP
      ? 'Se dibujan encima del vídeo y se añaden donde está el cabezal; luego puedes alargarlos y ajustarlos.'
      : 'Transforman toda la imagen durante un tramo: glitch, VHS, temblor, flashes…'));
    const grid = (list) => {
      const g = h('div', { class: 'grid' });
      for (const d of list) g.append(thumbCard(isP ? 'particles' : 'post', d.id, d.n, () => this.app.addFx(d.id, isP ? 'particles' : 'post')));
      return g;
    };
    if (isP) {
      b.append(h('h3', { class: 'sub-h' }, 'Luces y estrellas'), grid(PARTICLES.filter((d) => d.cat === 'luz')));
      b.append(h('h3', { class: 'sub-h', style: 'margin-top:18px' }, 'Ambiente'), grid(PARTICLES.filter((d) => d.cat !== 'luz')));
    } else b.append(grid(POSTFX));
  }

  // ---------------- AJUSTES DEL CLIP ----------------
  inspectTab(only = 'all') {
    const body = this.body;
    const b = { append: (...xs) => body.append(...xs.filter((x) => x != null && x !== false)), classList: body.classList };
    const c = selectedClip();
    if (!c) return;
    const app = this.app;
    const solo = only !== 'all';
    if (solo) b.classList.add('solo');
    const sel = selectedClips();
    const multi = sel.length > 1;
    const kindOf = (k) => (k.type === 'image' ? 'video' : k.type);
    const GROUPS = {
      video: ['tf', 'crop', 'mask', 'adj', 'filter', 'filterAmt', 'chroma', 'blend', 'motion', 'transIn', 'transOut', 'xfade', 'volume', 'muted', 'afadeIn', 'afadeOut', 'lane'],
      text: ['font', 'weight', 'italic', 'upper', 'size', 'color', 'color2', 'stroke', 'shadow', 'bg', 'spacing', 'lineHeight', 'width', 'align', 'rot', 'x', 'y', 'opacity', 'inAnim', 'outAnim', 'loop', 'karaoke'],
      fx: ['intensity', 'speed', 'size', 'color', 'fade'],
      audio: ['volume', 'afadeIn', 'afadeOut'],
    };
    const pickGroups = (k) => { const o = {}; for (const g of GROUPS[kindOf(k)] || []) if (g in k) o[g] = structuredClone(k[g]); return o; };
    const diffLeaves = (a, bb, path = [], out = []) => {
      for (const key of Object.keys(bb)) {
        const x = a ? a[key] : undefined, y = bb[key];
        if (y && typeof y === 'object' && !Array.isArray(y)) diffLeaves(x || {}, y, [...path, key], out);
        else if (x !== y) out.push([[...path, key], y]);
      }
      return out;
    };
    const setPathM = (k, path, val) => {
      let o = k;
      for (let i = 0; i < path.length - 1; i++) { if (!o || !(path[i] in o)) return; o = o[path[i]]; }
      if (o && path[0] in k) o[path[path.length - 1]] = val;
    };
    const same = multi ? sel.filter((k) => k !== c && kindOf(k) === kindOf(c)) : [];
    let snap = pickGroups(c);
    const propagate = () => {
      if (!same.length) return;
      const cur = pickGroups(c);
      for (const k of same) for (const [path, val] of diffLeaves(snap, cur)) setPathM(k, path, val);
      snap = cur;
    };
    const live = () => { propagate(); app.changed(); };
    const done = () => { propagate(); commit(); };
    const ids = [...state.sel];
    const sec = (key, title, icn, ...kids) => {
      if (solo && key !== only) return null;
      return section(title, icn, true, ...kids);
    };
    const S = (label, obj, key, min, max, step, fmt) => slider(label, obj[key], min, max, step, (v) => { obj[key] = v; live(); }, done, fmt);
    const pct = (v) => Math.round(v * 100) + '%';
    const secs = (v) => v.toFixed(1) + ' s';
    const ltNow = () => clamp(state.time - c.start, 0, c.dur);
    const inside = () => state.time >= c.start - 1e-3 && state.time <= c.start + c.dur + 1e-3;

    // Control con keyframe (◆): si la propiedad está animada, mover el control crea/ajusta el keyframe en el cabezal
    const KS = (label, path, min, max, step, fmt, onCommit) => {
      const out = h('output');
      const inp = h('input', { type: 'range', min, max, step });
      const kb = h('button', { class: 'kfd', title: 'Añadir o quitar keyframe aquí', 'aria-label': 'Keyframe' }, '◆');
      const show = (v) => { out.textContent = fmt ? fmt(v) : fmtNum(v, step); };
      const sync = () => {
        const lt = ltNow(), v = valueAt(c, path, lt);
        if (!inp._drag) inp.value = v;
        show(v);
        kb.className = 'kfd' + (kfAt(c, path, lt) ? ' on' : hasKf(c, path) ? ' has' : '');
      };
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        setValue(c, path, ltNow(), v);
        show(v);
        kb.className = 'kfd' + (kfAt(c, path, ltNow()) ? ' on' : hasKf(c, path) ? ' has' : '');
        live();
      });
      inp.addEventListener('pointerdown', () => { inp._drag = true; });
      const rel = () => { inp._drag = false; };
      inp.addEventListener('pointerup', rel); inp.addEventListener('pointercancel', rel); inp.addEventListener('blur', rel);
      inp.addEventListener('change', () => { inp._drag = false; done(); onCommit && onCommit(); bus.emit('kf'); });
      inp.addEventListener('dblclick', () => {
        const def = min < 0 ? 0 : (min <= 1 && max >= 1 ? 1 : min);
        setValue(c, path, ltNow(), def); sync(); live(); done(); onCommit && onCommit();
      });
      kb.addEventListener('click', () => {
        if (!inside()) { toast('Pon el cabezal dentro del clip para poner un keyframe'); return; }
        const lt = ltNow();
        if (kfAt(c, path, lt)) removeKf(c, path, lt); else setKf(c, path, lt, valueAt(c, path, lt));
        app.changed(); onCommit && onCommit(); commit(); bus.emit('kf');
      });
      sync();
      this.refreshers.push(sync);
      return h('div', { class: 'field' }, h('label', {}, label, out, kb), inp);
    };
    const kfDef = (path) => propsFor(c).find((p) => p[0] === path);
    const K = (path, label, onCommit) => { const d = kfDef(path); return KS(label || d[1], path, d[2], d[3], d[4], d[5], onCommit); };
    const audioChanged = () => app.audioChanged();

    // cabecera
    const meta = {
      video: ['🎬', 'var(--clip-video)', 'Vídeo'], image: ['🖼️', 'var(--clip-video)', 'Imagen'],
      text: ['T', 'var(--clip-text)', 'Texto'], fx: ['✨', 'var(--clip-fx)', 'Efecto'], audio: ['🎵', 'var(--clip-audio)', 'Audio'],
    }[c.type];
    const m = c.media ? state.media.get(c.media) : null;
    let title = meta[2];
    if (m) title = m.name;
    if (c.type === 'fx') { const d = (c.kind === 'spectrum' ? SPEC_STYLES : c.kind === 'particles' ? PARTICLES : POSTFX).find((p) => p.id === c.fx); if (d) title = d.n; }
    if (c.type === 'text') title = c.text.split('\n')[0] || 'Texto';
    b.append(h('div', { class: 'clip-head' }, h('span', { class: 'badge', style: `background:${multi ? 'var(--accent)' : c.lane === 'overlay' ? 'var(--clip-over)' : meta[1]}` }, multi ? '☑' : meta[0]), h('b', {}, multi ? `${sel.length} clips seleccionados` : title)));
    if (multi) b.append(h('p', { class: 'hint' }, same.length ? `Lo que cambies aquí se aplica a los ${same.length + 1} clips de tipo «${meta[2]}». Los keyframes solo al último que tocaste.` : `Los clips seleccionados son de tipos distintos: aquí solo cambia el último que tocaste («${title}»).`));
    if (!solo) {
      b.append(h('div', { class: 'mini-btns' },
        h('button', { class: 'btn', onclick: () => { if (!splitClips(ids, state.time).length) toast('Coloca el cabezal dentro del clip para dividirlo'); } }, '✂ Dividir'),
        h('button', { class: 'btn', onclick: () => duplicateClips(ids) }, '⧉ Duplicar'),
        h('button', { class: 'btn danger', onclick: () => removeClips(ids) }, multi ? `🗑 ${sel.length}` : '🗑')));
    }

    // ---- keyframes ----
    if (!solo || only === 'kf') b.append(this.kfSection(c, sec, K, app, solo));

    const timing = multi ? [] : [
      slider('Empieza en', c.start, 0, Math.max(60, c.start + 30), 0.1, (v) => { c.start = v; live(); }, () => { bus.emit('change', { structural: true }); done(); }, secs),
      slider('Duración', c.dur, 0.2, this.maxDur(c), 0.1, (v) => { c.dur = v; live(); }, () => { bus.emit('change', { structural: true }); done(); }, secs),
    ];
    const speedCtl = (lo, hi) => (multi ? null : slider('Velocidad', c.speed, lo, hi, 0.05, (v) => {
      const src = c.dur * c.speed; c.speed = v; c.dur = Math.max(0.1, src / v);
      if (m && m.duration) c.dur = Math.min(c.dur, (m.duration - c.in) / v);
      live();
    }, () => { bus.emit('change', { structural: true }); app.audioChanged(); done(); }, (v) => v.toFixed(2) + '×'));

    if (c.type === 'video' || c.type === 'image') {
      const tf = c.tf;
      b.append(sec('pos', 'Posición y tamaño', '📐',
        h('div', { class: 'field' }, h('label', {}, 'Encaje'), chips([{ id: 'cover', n: 'Llenar', i: '⬛' }, { id: 'contain', n: 'Ajustar', i: '🔲' }], tf.fit, (v) => { tf.fit = v; live(); done(); this.render(); })),
        tf.fit === 'contain' ? toggle('Fondo desenfocado', tf.bgBlur, (v) => { tf.bgBlur = v; live(); done(); }) : null,
        K('tf.scale'), K('tf.x'), K('tf.y'), K('tf.rot'),
        h('div', { class: 'two' }, toggle('Espejo ↔', tf.flipX, (v) => { tf.flipX = v; live(); done(); }), toggle('Voltear ↕', tf.flipY, (v) => { tf.flipY = v; live(); done(); })),
        selectCtl('Capa', [{ id: 'video', n: 'Vídeo principal' }, { id: 'overlay', n: 'Superpuesto (encima)' }], c.lane, (v) => { c.lane = v; propagate(); bus.emit('change', { structural: true }); done(); }),
        ...timing,
        h('p', { class: 'hint' }, '💡 También puedes arrastrar la imagen con el dedo y pellizcar para cambiar el tamaño. Con ◆ animas cualquier valor.')));

      b.append(sec('opac', 'Opacidad y fusión', '🌗',
        K('tf.opacity'),
        selectCtl('Modo de fusión', BLENDS, c.blend, (v) => { c.blend = v; live(); done(); }),
        h('p', { class: 'hint' }, '«Pantalla» quita el negro: perfecto para vídeos de fuego, chispas o luces sobre fondo negro.')));

      b.append(sec('filter', 'Filtros', '🎨',
        h('div', { class: 'grid th-grid' }, ...Object.entries(FILTERS).map(([id, f]) => thumbCard('filter', id, f.n, () => { c.filter = id; live(); done(); this.render(); }, c.filter === id))),
        S('Intensidad del filtro', c, 'filterAmt', 0, 1, 0.01, pct)));

      const adjBox = h('div');
      for (const a of ADJ_CONTROLS) adjBox.append(S(a.n, c.adj, a.k, a.min, a.max, a.step || 0.01, a.step === 1 ? (v) => v + '°' : null));
      b.append(sec('adj', 'Ajustar color', '🎚️', adjBox,
        h('button', { class: 'btn block', style: 'margin-top:12px', onclick: () => { c.adj = { ...ADJ_DEFAULT }; live(); done(); this.render(); } }, '↺ Restablecer')));

      if (!multi) {
        const li = layerInfo(c);
        const isOv = c.lane === 'overlay';
        const nm = (k) => { const m = state.media.get(k.media); return (m && m.name) || (k.type === 'image' ? 'foto' : 'vídeo'); };
        b.append(sec('layer', 'Capas: qué va encima', '🗂️',
          h('p', { class: 'hint' }, li.total > 1 ? `En este momento hay ${li.total} imágenes una encima de otra. Esta es la capa ${li.pos} (la 1 es la de más abajo).` : 'En este momento no hay otro vídeo o foto debajo ni encima de este clip. Coloca el cabezal donde se juntan.'),
          li.below ? h('button', { class: 'btn block accent', style: 'margin-top:8px', onclick: () => { if (swapContent(c, li.below)) { toast('Intercambiados ✓'); this.render(); } } }, '⇅ Intercambiar con el de debajo (' + nm(li.below) + ')') : null,
          li.above ? h('button', { class: 'btn block accent', style: 'margin-top:8px', onclick: () => { if (swapContent(c, li.above)) { toast('Intercambiados ✓'); this.render(); } } }, '⇅ Intercambiar con el de encima (' + nm(li.above) + ')') : null,
          isOv ? h('div', { class: 'two', style: 'margin-top:8px' },
            h('button', { class: 'btn', onclick: () => { if (moveLayer(c, 1)) this.render(); else toast('Ya está en la capa de más arriba'); } }, '⬆ Subir capa'),
            h('button', { class: 'btn', onclick: () => { if (moveLayer(c, -1)) this.render(); else toast('Ya está justo encima del vídeo principal'); } }, '⬇ Bajar capa')) : null,
          h('p', { class: 'hint', style: 'margin-top:8px' }, 'Intercambiar cambia el vídeo o la foto que se ve en cada sitio: cada uno mantiene su tamaño, posición y efectos.')));
      }

      b.append(sec('motion', 'Movimiento', '🎥',
        chips(MOTIONS, c.motion.type, (v) => { c.motion.type = v; live(); done(); }),
        S('Intensidad', c.motion, 'amount', 0, 1, 0.01, pct)));

      {
        const nx = nextAdjacent(state.project, c);
        const cur = c.xfade && c.xfade.type !== 'none' ? c.xfade : null;
        const durS = slider('Duración', cur ? cur.dur : 0.8, 0.2, 2.5, 0.05, (v) => { if (c.xfade) c.xfade.dur = v; live(); }, () => { done(); bus.emit('change', { structural: true, keepPanel: true }); if (c.xfade && nx) app.preview(c.start + c.dur - c.xfade.dur / 2 - 0.4, c.xfade.dur + 0.8); }, secs);
        b.append(sec('xfade', 'Transición con el siguiente clip', '🔀',
          nx ? null : h('p', { class: 'hint' }, 'Este clip no tiene otro clip pegado justo después en su misma pista. Las transiciones se ponen entre dos clips seguidos: toca el botón «+» que aparece entre ellos en la línea de tiempo.'),
          nx ? chips(XFADES, cur ? cur.type : 'none', (v) => {
            c.xfade = v === 'none' ? null : { type: v, dur: XFADES.find((x) => x.id === v)?.dur || (cur ? cur.dur : 0.8) };
            done(); bus.emit('change', { structural: true, keepPanel: true });
            if (c.xfade) app.preview(c.start + c.dur - c.xfade.dur / 2 - 0.4, c.xfade.dur + 0.8);
            this.render();
          }) : null,
          nx && cur ? durS : null,
          nx ? h('button', { class: 'btn block', style: 'margin-top:12px', onclick: () => {
            const t0 = c.xfade;
            let n = 0;
            for (const k of state.project.clips) {
              if ((k.type === 'video' || k.type === 'image') && k.lane === c.lane && nextAdjacent(state.project, k)) { k.xfade = t0 ? { ...t0 } : null; n++; }
            }
            done(); bus.emit('change', { structural: true, keepPanel: true });
            toast(t0 ? `Transición puesta en ${n} cortes ✓` : `Transiciones quitadas de ${n} cortes`);
          } }, 'Aplicar a todos los cortes') : null,
          nx && cur ? h('button', { class: 'btn block', style: 'margin-top:8px', onclick: () => app.preview(c.start + c.dur - c.xfade.dur / 2 - 0.6, c.xfade.dur + 1.2) }, '▶ Ver la transición') : null));
      }
      b.append(sec('trans', 'Entrada y salida del clip', '🔀',
        h('div', { class: 'field' }, h('label', {}, 'Al entrar')),
        chips(TRANSITIONS, c.transIn.type, (v) => { c.transIn.type = v; live(); done(); app.preview(c.start, Math.min(c.dur, c.transIn.dur + 0.4)); }),
        S('Duración de entrada', c.transIn, 'dur', 0.1, 2, 0.05, secs),
        h('div', { class: 'field' }, h('label', {}, 'Al salir')),
        chips(TRANSITIONS, c.transOut.type, (v) => { c.transOut.type = v; live(); done(); app.preview(Math.max(c.start, c.start + c.dur - c.transOut.dur - 0.4), c.transOut.dur + 0.4); }),
        S('Duración de salida', c.transOut, 'dur', 0.1, 2, 0.05, secs)));

      b.append(sec('mask', 'Recorte y máscara', '✂️',
        S('Recortar izquierda', c.crop, 'l', 0, 0.45, 0.01, pct),
        S('Recortar derecha', c.crop, 'r', 0, 0.45, 0.01, pct),
        S('Recortar arriba', c.crop, 't', 0, 0.45, 0.01, pct),
        S('Recortar abajo', c.crop, 'b', 0, 0.45, 0.01, pct),
        selectCtl('Máscara', MASKS, c.mask.type, (v) => { c.mask.type = v; live(); done(); }),
        S('Tamaño de máscara', c.mask, 'size', 0.2, 1.5, 0.01, pct),
        S('Suavizado del borde', c.mask, 'feather', 0, 1, 0.01, pct)));

      b.append(sec('key', 'Pantalla verde (croma)', '🟩',
        toggle('Quitar fondo de color', c.chroma.on, (v) => { c.chroma.on = v; if (v && c.lane === 'video') toast('Consejo: pon este clip en la capa «Superpuesto» para ver lo que hay detrás'); live(); done(); }),
        color('Color a quitar', c.chroma.color, (v) => { c.chroma.color = v; live(); }, done),
        h('button', { class: 'btn block', style: 'margin:6px 0 10px', onclick: () => app.pickColor(c, () => this.render()) }, '🎯 Tocar el color en la imagen'),
        h('div', { class: 'two' },
          h('button', { class: 'btn', onclick: () => { c.chroma.color = '#00ff00'; live(); done(); this.render(); } }, 'Verde'),
          h('button', { class: 'btn', onclick: () => { c.chroma.color = '#0047ff'; live(); done(); this.render(); } }, 'Azul')),
        S('Tolerancia', c.chroma, 'sim', 0, 1, 0.01, pct),
        S('Suavizado', c.chroma, 'smooth', 0, 1, 0.01, pct),
        S('Quitar reflejo del borde', Object.assign(c.chroma, { spill: c.chroma.spill == null ? 0.6 : c.chroma.spill }), 'spill', 0, 1, 0.01, pct),
        S('Afinar borde (más cerrado)', Object.assign(c.chroma, { choke: c.chroma.choke || 0 }), 'choke', 0, 1, 0.01, pct)));

      if (c.type === 'video') {
        b.append(sec('speed', 'Velocidad', '⏩', speedCtl(0.25, 4), h('p', { class: 'hint' }, 'Doble toque en el control para volver a 1×.')));
        b.append(sec('vol', 'Volumen y sonido', '🔊',
          toggle('Silenciar este clip', c.muted, (v) => { c.muted = v; app.audioChanged(); done(); this.render(); }),
          c.muted ? null : K('volume', 'Volumen', audioChanged),
          c.muted ? null : toggle('Es voz (narración)', c.role === 'voice', (v) => { c.role = v ? 'voice' : null; app.audioChanged(); done(); this.render(); }),
          c.muted ? null : slider('Fundido de entrada', c.afadeIn, 0, 5, 0.1, (v) => { c.afadeIn = v; }, () => { app.audioChanged(); done(); }, secs),
          c.muted ? null : slider('Fundido de salida', c.afadeOut, 0, 5, 0.1, (v) => { c.afadeOut = v; }, () => { app.audioChanged(); done(); }, secs),
          m && m.audioFallback ? h('p', { class: 'hint' }, 'ℹ️ El navegador no pudo separar el sonido de este vídeo (suele pasar con archivos muy grandes). Sonará directamente al reproducir, pero en iPad el volumen y los fundidos no se aplican y no se incluirá al exportar.') : null,
          m && !m.buffer && !m.audioFallback ? h('p', { class: 'hint' }, 'Este vídeo no tiene sonido.') : null,
          h('p', { class: 'hint' }, '💡 Con ◆ puedes poner keyframes de volumen: por ejemplo, bajar la música mientras hablas.')));
      }
    } else if (c.type === 'text') {
      const ta = h('textarea', {}, c.text);
      ta.addEventListener('input', () => { c.text = ta.value; live(); });
      ta.addEventListener('change', () => { bus.emit('change', { structural: true, keepPanel: true }); done(); });
      b.append(sec('txt', 'Texto', '✏️',
        multi ? null : ta,
        h('div', { class: 'field' }, h('label', {}, 'Estilos rápidos')),
        h('div', { class: 'grid' }, ...TEXT_STYLES.map((s) => h('button', { class: 'card style-card', onclick: () => { Object.assign(c, structuredClone(s.p)); live(); done(); this.render(); } }, h('span', { style: s.css }, 'Aa'), h('small', {}, s.n)))),
        ...timing));

      b.append(sec('tstyle', 'Estilo', '🎨',
        fontPicker(c.font, (v) => { c.font = v; live(); done(); }),
        K('size'),
        h('div', { class: 'field' }, h('label', {}, 'Grosor'), chips([{ id: 400, n: 'Normal' }, { id: 700, n: 'Negrita' }, { id: 900, n: 'Extra' }], c.weight, (v) => { c.weight = v; live(); done(); })),
        h('div', { class: 'two' }, toggle('Cursiva', c.italic, (v) => { c.italic = v; live(); done(); }), toggle('MAYÚSCULAS', c.upper, (v) => { c.upper = v; live(); done(); })),
        h('div', { class: 'field' }, h('label', {}, 'Alineación'), chips([{ id: 'left', n: 'Izquierda' }, { id: 'center', n: 'Centro' }, { id: 'right', n: 'Derecha' }], c.align, (v) => { c.align = v; live(); done(); })),
        color('Color', c.color, (v) => { c.color = v; live(); }, done),
        toggle('Degradado de color', !!c.color2, (v) => { c.color2 = v ? '#c8921a' : ''; live(); done(); this.render(); }),
        c.color2 ? color('Segundo color', c.color2, (v) => { c.color2 = v; live(); }, done) : null,
        c.karaoke ? color('Color de la palabra que suena', c.karaoke.color, (v) => { c.karaoke.color = v; live(); }, done) : null,
        S('Borde', c.stroke, 'w', 0, 0.03, 0.001, (v) => Math.round(v * 1000) + ''),
        color('Color del borde', c.stroke.color, (v) => { c.stroke.color = v; live(); }, done),
        S('Sombra / brillo', c.shadow, 'blur', 0, 1.5, 0.01, pct),
        color('Color de sombra', c.shadow.color, (v) => { c.shadow.color = v; live(); }, done),
        toggle('Fondo detrás del texto', c.bg.on, (v) => { c.bg.on = v; live(); done(); }),
        color('Color del fondo', c.bg.color, (v) => { c.bg.color = v; live(); }, done),
        S('Opacidad del fondo', c.bg, 'alpha', 0, 1, 0.01, pct),
        S('Espacio entre letras', c, 'spacing', -0.1, 0.5, 0.005),
        S('Interlineado', c, 'lineHeight', 0.8, 2, 0.01)));

      b.append(sec('tpos', 'Posición', '📐',
        K('x'), K('y'), K('rot'), K('opacity'),
        S('Ancho máximo', c, 'width', 0.2, 1, 0.01, pct),
        h('p', { class: 'hint' }, '💡 Arrastra el texto sobre la imagen para colocarlo, y pellizca para cambiar su tamaño.')));

      b.append(sec('tanim', 'Animación', '✨',
        h('div', { class: 'field' }, h('label', {}, 'Aparición')),
        chips(TEXT_IN, c.inAnim.type, (v) => { c.inAnim.type = v; const d = TEXT_IN.find((x) => x.id === v); if (d && d.dur) c.inAnim.dur = d.dur; live(); done(); app.preview(c.start, Math.min(c.dur, c.inAnim.dur + 0.5)); this.render(); }),
        S(/^texto\d$/.test(c.inAnim.type) ? 'Velocidad: duración de la aparición' : 'Duración de aparición', c.inAnim, 'dur', 0.1, 3, 0.05, secs),
        ['texto1','texto3','texto5','texto7','texto10','texto11'].includes(c.inAnim.type) ? slider('Intensidad del brillo', c.inAnim.flare == null ? 1 : c.inAnim.flare, 0, 1.5, 0.05, (v) => { c.inAnim.flare = v; live(); }, done, pct) : null,
        h('div', { class: 'field' }, h('label', {}, 'Desaparición')),
        chips(TEXT_OUT, c.outAnim.type, (v) => { c.outAnim.type = v; live(); done(); app.preview(Math.max(c.start, c.start + c.dur - c.outAnim.dur - 0.3), c.outAnim.dur + 0.3); }),
        S('Duración de desaparición', c.outAnim, 'dur', 0.1, 3, 0.05, secs),
        h('div', { class: 'field' }, h('label', {}, 'Mientras está en pantalla')),
        chips(TEXT_LOOP, c.loop.type, (v) => { c.loop.type = v; live(); done(); }),
        S('Intensidad', c.loop, 'amount', 0, 1, 0.01, pct)));
    } else if (c.type === 'fx' && c.kind === 'spectrum') {
      const st = c.style || c.fx;
      const circ = st === 'circle' || st === 'ring';
      const bars = !['line', 'area', 'wave', 'ring'].includes(st);
      const aud = state.project.clips.filter((x) => x.type === 'audio' || (x.type === 'video' && !x.muted)).map((x) => ({ id: x.id, n: (state.media.get(x.media)?.name || 'Audio').slice(0, 22) }));
      b.append(sec('fxp', 'Estilo', '🎵',
        chips(SPEC_STYLES, st, (v) => { c.fx = v; c.style = v; live(); done(); this.render(); }),
        selectCtl('Audio que mide', [{ id: 'all', n: 'Todo el audio del proyecto' }, ...aud], c.source || 'all', (v) => { c.source = v; live(); done(); }),
        S('Sensibilidad', c, 'sens', 0.2, 4, 0.05, (v) => v.toFixed(2) + '×'),
        S('Suavidad / caída', c, 'smooth', 0, 1, 0.01, pct),
        S('Opacidad', c, 'opacity', 0, 1, 0.01, pct),
        h('h3', { class: 'sub-h' }, 'Color'),
        chips([{ id: 'none', n: 'Un color' }, { id: 'v', n: 'Degradado vertical' }, { id: 'h', n: 'Degradado horizontal' }], c.grad || 'v', (v) => { c.grad = v; live(); done(); }),
        color('Color', c.color, (v) => { c.color = v; live(); }, done),
        color('Color 2', c.color2 || '#ff4fd8', (v) => { c.color2 = v; live(); }, done),
        S('Resplandor', c, 'glow', 0, 1, 0.01, pct),
        h('h3', { class: 'sub-h' }, 'Forma y tamaño'),
        S('Número de barras', c, 'bars', 8, 160, 1, (v) => Math.round(v) + ''),
        bars || circ ? S('Separación', c, 'gap', 0, 0.9, 0.01, pct) : null,
        bars ? toggle('Puntas redondeadas', c.round, (v) => { c.round = v; live(); done(); }) : null,
        !bars && !circ ? S('Grosor de línea', c, 'thick', 0.002, 0.04, 0.001, (v) => (v * 100).toFixed(1)) : null,
        S('Altura', c, 'height', 0.04, 0.8, 0.01, pct),
        circ ? S('Radio', c, 'radius', 0.05, 0.45, 0.005, pct) : S('Anchura', c, 'width', 0.1, 1.2, 0.01, pct),
        circ ? S('Giro continuo', c, 'spin', -90, 90, 1, (v) => Math.round(v) + '°/s') : null,
        ['bars', 'dots', 'line', 'area', 'circle'].includes(st) ? toggle('Reflejar (arriba y abajo)', c.mirror, (v) => { c.mirror = v; live(); done(); }) : null,
        S('Frecuencia mínima', c, 'fmin', 20, 2000, 10, (v) => Math.round(v) + ' Hz'),
        S('Frecuencia máxima', c, 'fmax', 2000, 20000, 100, (v) => Math.round(v) + ' Hz'),
        h('h3', { class: 'sub-h' }, 'Posición'),
        S('Horizontal', c, 'x', -1, 1, 0.01, (v) => v.toFixed(2)),
        S('Vertical', c, 'y', -1, 1, 0.01, (v) => v.toFixed(2)),
        S('Rotación', c, 'rot', -180, 180, 1, (v) => Math.round(v) + '°'),
        K('intensity'),
        S('Fundido entrada/salida', c, 'fade', 0, 3, 0.05, secs),
        ...timing));
    } else if (c.type === 'fx') {
      const isP = c.kind === 'particles';
      const list = isP ? PARTICLES : POSTFX;
      b.append(sec('fxp', 'Efecto', '✨',
        chips(list.map((d) => ({ id: d.id, n: d.n })), c.fx, (v) => { c.fx = v; const d = list.find((x) => x.id === v); if (isP && d.color) c.color = d.color; bus.emit('change', { structural: true }); done(); }),
        K('intensity'),
        S('Velocidad', c, 'speed', 0.1, 3, 0.05, (v) => v.toFixed(2) + '×'),
        isP ? K('size') : null,
        isP ? color('Color', c.color, (v) => { c.color = v; live(); }, done) : null,
        S('Fundido entrada/salida', c, 'fade', 0, 3, 0.05, secs),
        isP ? h('button', { class: 'btn block', style: 'margin-top:10px', onclick: () => { c.seed = Math.floor(Math.random() * 1000); live(); done(); } }, '🎲 Otra variación') : null,
        ...timing));
    } else if (c.type === 'audio') {
      b.append(sec('vol', 'Volumen', '🔊',
        K('volume', 'Volumen', audioChanged),
        toggle('Es voz (narración)', c.role === 'voice', (v) => { c.role = v ? 'voice' : null; app.audioChanged(); done(); this.render(); }),
        c.role === 'voice' ? null : toggle('Bajar cuando hay voz', !!(c.duck && c.duck.on), (v) => { c.duck = Object.assign({ db: -14 }, c.duck, { on: v }); app.audioChanged(); done(); this.render(); }),
        c.role !== 'voice' && c.duck && c.duck.on ? slider('Cuánto baja', c.duck.db, -30, -4, 1, (v) => { c.duck.db = v; }, () => { app.audioChanged(); done(); }, (v) => v + ' dB') : null,
        
        slider('Fundido de entrada', c.afadeIn, 0, 8, 0.1, (v) => { c.afadeIn = v; }, () => { app.audioChanged(); done(); }, secs),
        slider('Fundido de salida', c.afadeOut, 0, 8, 0.1, (v) => { c.afadeOut = v; }, () => { app.audioChanged(); done(); }, secs),
        ...timing,
        h('p', { class: 'hint' }, '💡 Arrastra los bordes del clip en la línea de tiempo para recortarlo. Con ◆ puedes subir y bajar el volumen en distintos momentos.')));
      b.append(sec('speed', 'Velocidad', '⏩', speedCtl(0.5, 2)));
    }
  }

  // Sección de keyframes: navegación entre rombos + todos los valores animables
  kfSection(c, sec, K, app, solo) {
    const nav = h('div', { class: 'kf-nav' });
    const prev = h('button', { class: 'btn', 'aria-label': 'Keyframe anterior' }, icon('prev', 22));
    const next = h('button', { class: 'btn', 'aria-label': 'Keyframe siguiente' }, icon('next', 22));
    const lab = h('b');
    nav.append(prev, lab, next);
    const big = h('button', { class: 'btn kf-big' });
    const sync = () => {
      const lt = state.time - c.start;
      const ts = kfTimes(c);
      const inClip = lt >= -1e-3 && lt <= c.dur + 1e-3;
      const on = inClip && anyKfAt(c, lt);
      lab.textContent = !inClip ? 'El cabezal está fuera del clip' : ts.length ? `${ts.length} keyframe${ts.length > 1 ? 's' : ''} · ${on ? 'en este punto' : fmtTime(Math.max(0, lt))}` : 'Sin keyframes todavía';
      big.textContent = on ? '◆ Quitar keyframe de aquí' : '◆ Añadir keyframe aquí';
      big.classList.toggle('on', on);
      prev.disabled = !ts.some((t) => t < lt - 0.04);
      next.disabled = !ts.some((t) => t > lt + 0.04);
    };
    prev.onclick = () => { const lt = state.time - c.start; const t = kfTimes(c).filter((x) => x < lt - 0.04).pop(); if (t != null) app.seek(c.start + t); };
    next.onclick = () => { const lt = state.time - c.start; const t = kfTimes(c).find((x) => x > lt + 0.04); if (t != null) app.seek(c.start + t); };
    big.onclick = () => {
      const lt = state.time - c.start;
      if (lt < -1e-3 || lt > c.dur + 1e-3) { toast('Pon el cabezal dentro del clip'); return; }
      toggleAllKf(c, clamp(lt, 0, c.dur));
      app.changed(); app.audioChanged(); commit(); bus.emit('kf');
    };
    sync();
    this.refreshers.push(sync);
    const ease = toggle('Movimiento suave entre keyframes', c.kfEase !== 'linear', (v) => { c.kfEase = v ? 'smooth' : 'linear'; app.changed(); app.audioChanged(); commit(); });
    const clearAll = h('button', { class: 'btn danger block', style: 'margin-top:12px', onclick: () => {
      if (!anyKf(c)) return;
      const lt = clamp(state.time - c.start, 0, c.dur);
      for (const p in c.kf) { const v = valueAt(c, p, lt); delete c.kf[p]; const parts = p.split('.'); let o = c; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = v; }
      app.changed(); app.audioChanged(); commit(); bus.emit('kf'); this.render();
    } }, 'Borrar todos los keyframes de este clip');
    const props = propsFor(c).filter((p) => !(p[0] === 'volume' && c.type === 'video' && c.muted));
    const kids = [
      h('p', { class: 'hint' }, 'Mueve el cabezal a un momento, pulsa ◆ y cambia los valores. Repite en otro momento: el clip se animará solo entre un keyframe y otro.'),
      nav, big,
      ...props.map((p) => K(p[0], p[1], p[0] === 'volume' ? () => app.audioChanged() : null)),
      ease, clearAll,
    ];
    if (solo) return sec('kf', 'Keyframes', '◆', ...kids);
    return section('Keyframes', '◆', anyKf(c), ...kids);
  }

  maxDur(c) {
    const m = c.media ? state.media.get(c.media) : null;
    if ((c.type === 'video' || c.type === 'audio') && m && m.duration) return Math.max(0.2, (m.duration - c.in) / c.speed);
    return Math.max(30, c.dur * 2);
  }

  projectFields(b) {
    b.append(color('Color de fondo del vídeo', state.project.bg, (v) => { state.project.bg = v; this.app.changed(); }, () => commit()));
    b.append(h('p', { class: 'hint' }, 'Se ve donde la imagen no llena todo el formato (por ejemplo con «Ajustar» en vez de «Llenar»).'));
    const sw = h('div', { class: 'grid', style: 'grid-template-columns:repeat(6,1fr);gap:8px' });
    for (const col of ['#000000', '#ffffff', '#1f2a44', '#3b2a4f', '#f3e7cf', '#0f3d3a']) {
      sw.append(h('button', { class: 'card', style: `min-height:48px;background:${col}`, 'aria-label': col, onclick: () => { state.project.bg = col; this.app.changed(); commit(); this.render(); } }));
    }
    b.append(sw);
    b.append(h('button', { class: 'btn block', style: 'margin-top:14px', onclick: () => this.app.openProject() }, '📐 Formato y nombre del proyecto'));
  }
}

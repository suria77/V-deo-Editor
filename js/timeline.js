// Línea de tiempo táctil: pistas, clips arrastrables, recorte por los bordes, imán y cabezal.
import { state, bus, LANES, LANE_NAMES, select, toggleSel, selectIds, commit, projectDuration } from './state.js';
import { h, fmtTime } from './ui.js';
import { PARTICLES, POSTFX } from './presets.js';
import { kfTimes } from './kf.js';

const LABEL_W = 78;
const ROW_H = { overlay: 58, video: 64, text: 46, fx: 46, audio: 54 };
const GHOST = {
  overlay: 'Vídeos o fotos encima (PiP, pantalla verde, overlays)',
  video: 'Tu vídeo principal',
  text: 'Títulos y subtítulos',
  fx: 'Fuego, niebla, partículas, glitch…',
  audio: 'Música y voz en off',
};

export class Timeline {
  constructor(scroll, inner, app) {
    this.scroll = scroll;
    this.inner = inner;
    this.app = app;
    this.pps = 70;
    this.clipEls = new Map();
    bus.on('change', (e) => { if (e && e.structural) this.render(); else this.updateKf(); });
    bus.on('kf', () => this.updateKf());
    bus.on('select', () => this.updateSel());
    bus.on('selectmode', () => { this.scroll.classList.toggle('selmode', state.selectMode); });
    this.bindBand();
    bus.on('time', () => this.updatePlayhead());
    bus.on('media', () => this.render());
    window.addEventListener('resize', () => this.render());
  }

  x(t) { return LABEL_W + t * this.pps; }
  tAt(clientX) {
    const r = this.inner.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - LABEL_W) / this.pps);
  }

  setZoom(pps) {
    const center = this.tAt(this.scroll.getBoundingClientRect().left + this.scroll.clientWidth / 2);
    this.pps = pps;
    this.render();
    this.scroll.scrollLeft = Math.max(0, this.x(center) - this.scroll.clientWidth / 2);
  }

  layout() {
    const lanes = [];
    for (const lane of LANES) {
      const clips = state.project.clips.filter((c) => c.lane === lane).sort((a, b) => a.start - b.start);
      const rowsEnd = [];
      const placed = clips.map((c) => {
        let r = rowsEnd.findIndex((end) => end <= c.start + 1e-3);
        if (r < 0) { r = rowsEnd.length; rowsEnd.push(0); }
        rowsEnd[r] = c.start + c.dur;
        return { c, row: r };
      });
      const rows = Math.max(1, rowsEnd.length);
      lanes.push({ lane, placed, rows, height: rows * ROW_H[lane] + 8 });
    }
    return lanes;
  }

  render() {
    const dur = projectDuration();
    const viewSec = this.scroll.clientWidth / this.pps;
    const total = Math.max(dur + 8, viewSec);
    const width = LABEL_W + total * this.pps;
    this.inner.innerHTML = '';
    this.inner.style.width = width + 'px';
    this.clipEls.clear();

    // regla
    const ruler = h('div', { class: 'ruler', style: `width:${width}px` });
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => s * this.pps >= 70) || 120;
    for (let t = 0; t <= total; t += step) {
      ruler.append(h('div', { class: 'tick', style: `left:${this.x(t)}px` }, fmtTime(t, false)));
      const sub = step / 2;
      if (sub * this.pps > 20) ruler.append(h('div', { class: 'tick minor', style: `left:${this.x(t + sub)}px;top:22px` }));
    }
    this.bindScrub(ruler);
    this.inner.append(ruler);

    for (const L of this.layout()) {
      const lane = h('div', { class: 'lane', style: `height:${L.height}px;width:${width}px` });
      const area = h('div', { class: 'area' });
      lane.append(h('div', { class: 'lbl' }, LANE_NAMES[L.lane]), area);
      if (!L.placed.length) area.append(h('div', { class: 'ghost' }, GHOST[L.lane]));
      this.bindTapSeek(area);
      for (const { c, row } of L.placed) {
        const el = this.clipEl(c);
        el.style.top = 4 + row * ROW_H[L.lane] + 'px';
        el.style.height = ROW_H[L.lane] - 6 + 'px';
        area.append(el);
        this.clipEls.set(c.id, el);
        if (el._wave) requestAnimationFrame(() => this.drawWave(el._wave, c));
      }
      this.inner.append(lane);
    }
    this.playhead = h('div', { class: 'playhead' });
    this.inner.append(this.playhead);
    this.updatePlayhead();
    this.updateSel();
  }

  clipEl(c) {
    const m = c.media ? state.media.get(c.media) : null;
    const cls = ['clip', c.lane === 'overlay' ? 'overlay' : c.type];
    let label = '';
    const el = h('div', { class: cls.join(' '), 'data-id': c.id });
    if (c.type === 'video' || c.type === 'image') {
      if (m && m.thumb) el.append(h('div', { class: 'cl-bg', style: `background-image:url(${m.thumb})` }));
      label = (c.type === 'video' ? '🎬 ' : '🖼️ ') + (m ? m.name : 'Medio');
      if (c.speed !== 1) label += ` · ${c.speed}×`;
    } else if (c.type === 'audio') {
      const cv = h('canvas');
      el.append(cv);
      el._wave = cv;
      label = '🎵 ' + (m ? m.name : 'Audio');
    } else if (c.type === 'text') {
      label = 'T  ' + (c.text || '').replace(/\n/g, ' ');
    } else if (c.type === 'fx') {
      const d = (c.kind === 'particles' ? PARTICLES : POSTFX).find((p) => p.id === c.fx);
      label = d ? `${d.i} ${d.n}` : 'Efecto';
    }
    el.append(h('div', { class: 'cl-lab' }, label), h('div', { class: 'h l' }), h('div', { class: 'h r' }));
    this.place(el, c);
    this.bindClip(el, c);
    return el;
  }

  place(el, c) {
    el.style.left = this.x(c.start) + 'px';
    el.style.width = Math.max(14, c.dur * this.pps) + 'px';
    this.drawKf(el, c);
  }

  // rombos de keyframes sobre el clip (tocar uno = ir a ese instante)
  drawKf(el, c) {
    el.querySelectorAll('.kfm').forEach((d) => d.remove());
    for (const t of kfTimes(c)) {
      if (t < -1e-3 || t > c.dur + 1e-3) continue;
      const d = h('i', { class: 'kfm', style: `left:${t * this.pps}px` });
      d.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (!state.sel.has(c.id)) select(c.id); this.app.seek(c.start + t); });
      el.append(d);
    }
  }
  updateKf() {
    for (const [id, el] of this.clipEls) { const c = state.project.clips.find((k) => k.id === id); if (c) this.drawKf(el, c); }
  }

  drawWave(cv, c) {
    const m = state.media.get(c.media);
    if (!m || !m.peaks) return;
    const w = Math.min(4000, Math.max(10, Math.round(c.dur * this.pps)));
    const hgt = cv.clientHeight || 40;
    cv.width = w; cv.height = hgt;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,.55)';
    const per = 40;
    for (let x = 0; x < w; x += 2) {
      const t = c.in + (x / this.pps) * c.speed;
      const p = m.peaks[Math.floor(t * per)] || 0;
      const bh = Math.max(1, p * hgt * 0.9);
      g.fillRect(x, (hgt - bh) / 2, 1.5, bh);
    }
  }

  updateSel() {
    for (const [id, el] of this.clipEls) {
      el.classList.toggle('sel', state.sel.has(id));
      el.classList.toggle('prim', id === state.selection && state.sel.size > 1);
    }
  }

  // Rectángulo de selección (modo «Seleccionar»)
  bindBand() {
    this.inner.addEventListener('pointerdown', (e) => {
      if (!state.selectMode) return;
      if (e.target.closest('.clip') || e.target.closest('.ruler')) return;
      if (!e.target.closest('.lane')) return;
      e.preventDefault();
      const r0 = this.inner.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      const band = h('div', { class: 'band' });
      this.inner.append(band);
      let moved = false;
      this.inner.setPointerCapture(e.pointerId);
      const box = (ev) => ({ x1: Math.min(sx, ev.clientX), y1: Math.min(sy, ev.clientY), x2: Math.max(sx, ev.clientX), y2: Math.max(sy, ev.clientY) });
      const mv = (ev) => {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) moved = true;
        const b = box(ev);
        band.style.cssText = `left:${b.x1 - r0.left}px;top:${b.y1 - r0.top}px;width:${b.x2 - b.x1}px;height:${b.y2 - b.y1}px`;
        // vista previa de lo que quedaría seleccionado
        for (const [id, el] of this.clipEls) {
          const r = el.getBoundingClientRect();
          const hit = r.right >= b.x1 && r.left <= b.x2 && r.bottom >= b.y1 && r.top <= b.y2;
          el.classList.toggle('band-hit', hit);
        }
        // desplazamiento automático en los bordes
        const sr = this.scroll.getBoundingClientRect();
        if (ev.clientX > sr.right - 40) this.scroll.scrollLeft += 14;
        else if (ev.clientX < sr.left + LABEL_W + 20) this.scroll.scrollLeft -= 14;
        if (ev.clientY > sr.bottom - 30) this.scroll.scrollTop += 10;
        else if (ev.clientY < sr.top + 50) this.scroll.scrollTop -= 10;
      };
      const up = (ev) => {
        this.inner.removeEventListener('pointermove', mv);
        this.inner.removeEventListener('pointerup', up);
        this.inner.removeEventListener('pointercancel', up);
        band.remove();
        const hits = [];
        for (const [id, el] of this.clipEls) { if (el.classList.contains('band-hit')) hits.push(id); el.classList.remove('band-hit'); }
        if (moved) selectIds(hits);
        else this.app.seek(this.tAt(ev.clientX));
      };
      this.inner.addEventListener('pointermove', mv);
      this.inner.addEventListener('pointerup', up);
      this.inner.addEventListener('pointercancel', up);
    });
  }

  updatePlayhead() {
    if (!this.playhead) return;
    const x = this.x(state.time);
    this.playhead.style.left = x + 'px';
    if (state.playing) {
      const sl = this.scroll.scrollLeft, w = this.scroll.clientWidth;
      if (x > sl + w - 60 || x < sl + LABEL_W) this.scroll.scrollLeft = x - LABEL_W - 40;
    }
  }

  bindScrub(el) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.app.seek(this.tAt(e.clientX));
      const mv = (ev) => this.app.seek(this.tAt(ev.clientX));
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  bindTapSeek(area) {
    let sx = 0, sy = 0, ok = false;
    area.addEventListener('pointerdown', (e) => { if (e.target !== area) return; sx = e.clientX; sy = e.clientY; ok = true; });
    area.addEventListener('pointercancel', () => (ok = false));
    area.addEventListener('pointerup', (e) => {
      if (!ok || e.target !== area) return;
      ok = false;
      if (Math.abs(e.clientX - sx) < 8 && Math.abs(e.clientY - sy) < 8) {
        this.app.seek(this.tAt(e.clientX));
        select(null);
      }
    });
  }

  snapTargets(exceptId) {
    const ts = [0, state.time];
    for (const c of state.project.clips) if (c.id !== exceptId) ts.push(c.start, c.start + c.dur);
    return ts;
  }

  bindClip(el, c) {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
      const wasSel = state.sel.has(c.id);
      // al empezar: si no estaba seleccionado, se selecciona (en modo selección se añade al grupo)
      if (!wasSel) {
        if (state.selectMode) toggleSel(c.id); else select(c.id);
      } else if (state.selection !== c.id) {
        state.selection = c.id; bus.emit('select');
      }
      this.app.showInspector && this.app.showInspector();
      const x0 = e.clientX;
      const group = mode === 'move' ? [...state.sel].map((id) => state.project.clips.find((k) => k.id === id)).filter(Boolean) : [c];
      const origin = new Map(group.map((k) => [k.id, { start: k.start, dur: k.dur, in: k.in || 0, kf: k.kf ? structuredClone(k.kf) : null }]));
      const o = origin.get(c.id);
      const minStart = Math.min(...group.map((k) => origin.get(k.id).start));
      const m = c.media ? state.media.get(c.media) : null;
      const srcLimited = (c.type === 'video' || c.type === 'audio') && m && m.duration;
      const thr = 10 / this.pps;
      const gids = new Set(group.map((k) => k.id));
      const targets = [0, state.time];
      for (const k of state.project.clips) if (!gids.has(k.id)) targets.push(k.start, k.start + k.dur);
      const snap = (t) => { let best = t, bd = thr; for (const s of targets) { const d = Math.abs(s - t); if (d < bd) { bd = d; best = s; } } return best; };
      let moved = false;
      el.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        if (!moved && Math.abs(ev.clientX - x0) < 5) return;
        moved = true;
        const d = (ev.clientX - x0) / this.pps;
        const sp = c.speed || 1;
        if (mode === 'move') {
          let dd = Math.max(-minStart, d);
          const s1 = snap(o.start + dd) - o.start, s2 = snap(o.start + o.dur + dd) - o.start - o.dur;
          dd = Math.abs(s1 - dd) <= Math.abs(s2 - dd) ? s1 : s2;
          dd = Math.max(-minStart, dd);
          for (const k of group) { k.start = origin.get(k.id).start + dd; const ke = this.clipEls.get(k.id); if (ke) this.place(ke, k); }
        } else if (mode === 'l') {
          let ns = snap(o.start + d);
          let dd = ns - o.start;
          if (srcLimited) dd = Math.max(dd, -o.in / sp);
          dd = Math.max(dd, -o.start);
          dd = Math.min(dd, o.dur - 0.1);
          c.start = o.start + dd;
          c.dur = o.dur - dd;
          if ('in' in c) c.in = Math.max(0, o.in + dd * sp);
          if (o.kf) { c.kf = structuredClone(o.kf); for (const p in c.kf) for (const k of c.kf[p]) k.t -= dd; }
          this.place(el, c);
        } else {
          let ne = snap(o.start + o.dur + d);
          let nd = Math.max(0.1, ne - o.start);
          if (srcLimited) nd = Math.min(nd, (m.duration - o.in) / sp);
          c.dur = nd;
          this.place(el, c);
        }
        if (mode !== 'move') this.app.seek(mode === 'l' ? c.start : c.start + c.dur - 0.001, true);
        bus.emit('change', { live: true });
      };
      const up = () => {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (moved) {
          this.render();
          bus.emit('change', { structural: false, timing: true });
          commit();
        } else if (wasSel && !state.selectMode) {
          // toque simple sobre un clip ya seleccionado → queda solo ese
          if (state.sel.size > 1) select(c.id);
        } else if (wasSel && state.selectMode) {
          toggleSel(c.id);
        }
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
}

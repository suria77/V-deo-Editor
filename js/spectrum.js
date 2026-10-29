// Espectro de audio: análisis FFT determinista (solo depende del tiempo) + dibujo de varios estilos.
// Al ser una función pura del instante t, el scrub y la exportación frame a frame salen idénticos.

export const SPEC_STYLES = [
  { id: 'bars', n: 'Barras', i: '▮' },
  { id: 'mirror', n: 'Barras espejo', i: '≣' },
  { id: 'blocks', n: 'Bloques LED', i: '▤' },
  { id: 'dots', n: 'Puntos', i: '●' },
  { id: 'line', n: 'Línea', i: '〰' },
  { id: 'area', n: 'Montañas', i: '⛰' },
  { id: 'wave', n: 'Onda simétrica', i: '≋' },
  { id: 'circle', n: 'Circular', i: '✺' },
  { id: 'ring', n: 'Anillo', i: '◎' },
];

export const SPEC_DEFAULT = {
  color: '#7cf3ff', color2: '#ff4fd8', grad: 'v', bars: 48, gap: 0.35, round: true,
  height: 0.32, width: 0.8, x: 0, y: 0.45, rot: 0, thick: 0.012, sens: 1, smooth: 0.5,
  glow: 0.45, fmin: 40, fmax: 12000, mirror: false, opacity: 1, source: 'all', radius: 0.2, spin: 0,
};

export function specDefaults(style = 'bars') {
  const d = { ...SPEC_DEFAULT };
  if (style === 'circle' || style === 'ring') { d.y = 0; d.bars = 72; d.height = 0.14; d.gap = 0.3; }
  if (style === 'mirror' || style === 'wave') { d.y = 0; d.height = 0.22; }
  if (style === 'dots') { d.bars = 36; d.gap = 0.25; }
  if (style === 'blocks') { d.bars = 28; d.gap = 0.25; d.round = false; }
  if (style === 'line' || style === 'area') { d.bars = 64; }
  return d;
}

// ---------- FFT ----------
const N = 2048;
const HANN = new Float32Array(N);
for (let i = 0; i < N; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
const REV = new Uint16Array(N);
for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); REV[i] = r; }
const COS = new Float32Array(N / 2), SIN = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / N); SIN[i] = -Math.sin((2 * Math.PI * i) / N); }
const re = new Float32Array(N), im = new Float32Array(N);

function fft(x) { // x: Float32Array(N) ya con ventana → magnitudes (N/2) normalizadas
  for (let i = 0; i < N; i++) { re[REV[i]] = x[i]; im[REV[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * COS[k] - im[b] * SIN[k], ti = re[b] * SIN[k] + im[b] * COS[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  const out = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) out[i] = (Math.hypot(re[i], im[i]) * 4) / N;
  return out;
}

// magnitudes del instante t (mezcla de los audios activos o de uno concreto)
const win = new Float32Array(N);
function magsAt(project, media, t, source) {
  win.fill(0);
  let any = false, sr = 44100;
  for (const c of project.clips) {
    if (c.type !== 'audio' && c.type !== 'video') continue;
    if (c.type === 'video' && c.muted) continue;
    if (source !== 'all' && c.id !== source) continue;
    if (t < c.start || t >= c.start + c.dur) continue;
    const m = media.get(c.media);
    const buf = m && m.buffer;
    if (!buf) continue;
    sr = buf.sampleRate;
    const st = (c.in || 0) + (t - c.start) * (c.speed || 1);
    const s0 = Math.floor(st * sr) - N / 2;
    const vol = c.volume == null ? 1 : c.volume;
    const ch = buf.numberOfChannels;
    for (let k = 0; k < ch; k++) {
      const d = buf.getChannelData(k);
      for (let i = 0; i < N; i++) { const p = s0 + i; if (p >= 0 && p < d.length) win[i] += (d[p] * vol) / ch; }
    }
    any = true;
  }
  if (!any) return null;
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = win[i] * HANN[i];
  return { mags: fft(x), sr };
}

// ---------- bandas ----------
const cache = new Map();
export const clearSpectrumCache = () => cache.clear();
function levels(project, media, c, t) {
  const n = Math.max(4, Math.round(c.bars));
  const key = (tt) => `${c.source}|${Math.round(tt * 90)}`;
  const raw = (tt) => {
    const k = key(tt);
    let r = cache.get(k);
    if (r === undefined) { r = magsAt(project, media, tt, c.source) || false; cache.set(k, r); if (cache.size > 600) cache.delete(cache.keys().next().value); }
    return r;
  };
  const dt = 1 / 30, K = 8;
  const tau = 0.02 + c.smooth * c.smooth * 0.5;
  const out = new Float32Array(n);
  const lo = Math.max(20, c.fmin), hi = Math.max(lo * 1.5, c.fmax);
  for (let k = 0; k <= K; k++) {
    const tt = t - k * dt;
    if (tt < 0) break;
    const r = raw(tt);
    if (!r) continue;
    const hz = r.sr / N, w = Math.exp(-(k * dt) / tau);
    for (let i = 0; i < n; i++) {
      const f0 = lo * Math.pow(hi / lo, i / n), f1 = lo * Math.pow(hi / lo, (i + 1) / n);
      const b0 = Math.floor(f0 / hz), b1 = Math.max(b0 + 1, Math.ceil(f1 / hz));
      let pk = 0;
      for (let b = b0; b < b1 && b < N / 2; b++) pk = Math.max(pk, r.mags[b]);
      const fc = Math.sqrt(f0 * f1);
      const tilt = Math.pow(fc / 500, 0.35); // compensa que los agudos tienen menos energía
      const db = 20 * Math.log10(pk * tilt * c.sens + 1e-6);
      const v = Math.min(1, Math.max(0, (db + 62) / 52));
      out[i] = Math.max(out[i], v * w);
    }
  }
  // suavizado entre vecinas para que no sea tan dentado
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) sm[i] = (out[Math.max(0, i - 1)] + 2 * out[i] + out[Math.min(n - 1, i + 1)]) / 4;
  return sm;
}

const mix = (a, b, f) => {
  const p = (h, o) => parseInt(h.slice(1 + o * 2, 3 + o * 2), 16);
  const r = Math.round(p(a, 0) + (p(b, 0) - p(a, 0)) * f), g = Math.round(p(a, 1) + (p(b, 1) - p(a, 1)) * f), bl = Math.round(p(a, 2) + (p(b, 2) - p(a, 2)) * f);
  return `rgb(${r},${g},${bl})`;
};

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, Math.abs(h) / 2);
  ctx.beginPath();
  if (r <= 0.5) { ctx.rect(x, y, w, h); return; }
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

// recuadro del espectro en píxeles de pantalla (para seleccionarlo y moverlo sobre la imagen)
export function specBounds(cIn, W, H) {
  const c = { ...SPEC_DEFAULT, ...cIn };
  const st = c.style || c.fx, S = Math.min(W, H);
  const ox = W / 2 + c.x * W / 2, oy = H / 2 + c.y * H / 2;
  let w, h, ly = 0;
  if (st === 'circle' || st === 'ring') { const e = (c.radius + c.height * 1.6) * S; w = h = 2 * e; }
  else {
    w = c.width * W;
    const sym = st === 'mirror' || st === 'wave' || c.mirror;
    h = (sym ? 2 : 1) * c.height * H; if (!sym) ly = -h / 2;
  }
  const rot = (c.rot * Math.PI) / 180;
  return { cx: ox - Math.sin(rot) * ly, cy: oy + Math.cos(rot) * ly, w: w + 24, h: h + 24, rot, a: 1 };
}

export function hasSignal(project, media, c, t) {
  return !!magsAt(project, media, t, c.source || 'all');
}

// ---------- dibujo ----------
export function drawSpectrum(ctx, cIn, t, W, H, project, media) {
  const c = { ...SPEC_DEFAULT, ...cIn };
  const lv = levels(project, media, c, t);
  const n = lv.length;
  const lt = t - c.start;
  const fade = Math.max(0.01, c.fade ?? 0.3);
  const g = Math.max(0, Math.min(1, lt / fade, (c.dur - lt) / fade));
  const alpha = c.opacity * g * (c.intensity == null ? 1 : Math.min(1, c.intensity * 1.2));
  if (alpha <= 0.001) return false;
  const S = Math.min(W, H);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2 + c.x * W / 2, H / 2 + c.y * H / 2);
  ctx.rotate((c.rot + (c.style === 'circle' || c.style === 'ring' ? c.spin * t : 0)) * Math.PI / 180);
  const bw = c.width * W, bh = c.height * H;
  if (c.glow > 0) { ctx.shadowColor = c.color2 && c.grad !== 'none' ? c.color : c.color; ctx.shadowBlur = c.glow * S * 0.04; }
  const colorAt = (i, v) => (c.grad === 'none' ? c.color : c.grad === 'h' ? mix(c.color, c.color2, n > 1 ? i / (n - 1) : 0) : mix(c.color, c.color2, v));
  const vgrad = (y0, y1) => { const gr = ctx.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, c.color); gr.addColorStop(1, c.color2); return gr; };
  const hgrad = () => { const gr = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0); gr.addColorStop(0, c.color); gr.addColorStop(1, c.color2); return gr; };
  const fillFor = (y0, y1) => (c.grad === 'none' ? c.color : c.grad === 'h' ? hgrad() : vgrad(y0, y1));
  const cell = bw / n, barW = Math.max(1, cell * (1 - c.gap));
  const rad = c.round ? barW / 2 : 0;
  const min = Math.max(2, barW * 0.5);

  switch (c.style) {
    case 'bars':
    case 'mirror': {
      const sym = c.style === 'mirror' || c.mirror;
      ctx.fillStyle = fillFor(sym ? -bh : -bh, sym ? bh : 0);
      if (c.grad === 'v') { const gr = sym ? (() => { const q = ctx.createLinearGradient(0, -bh, 0, bh); q.addColorStop(0, c.color2); q.addColorStop(0.5, c.color); q.addColorStop(1, c.color2); return q; })() : (() => { const q = ctx.createLinearGradient(0, 0, 0, -bh); q.addColorStop(0, c.color); q.addColorStop(1, c.color2); return q; })(); ctx.fillStyle = gr; }
      for (let i = 0; i < n; i++) {
        const x = -bw / 2 + i * cell + (cell - barW) / 2, hh = Math.max(min, lv[i] * bh);
        if (c.grad === 'h') ctx.fillStyle = colorAt(i, lv[i]);
        if (sym) rrect(ctx, x, -hh, barW, hh * 2, rad); else rrect(ctx, x, -hh, barW, hh, rad);
        ctx.fill();
      }
      break;
    }
    case 'blocks': {
      const seg = Math.max(4, Math.round(c.height * 40)), segH = bh / seg;
      for (let i = 0; i < n; i++) {
        const x = -bw / 2 + i * cell + (cell - barW) / 2, on = Math.round(lv[i] * seg);
        for (let s = 0; s < on; s++) {
          ctx.fillStyle = c.grad === 'none' ? c.color : c.grad === 'h' ? colorAt(i, 0) : mix(c.color, c.color2, s / Math.max(1, seg - 1));
          rrect(ctx, x, -(s + 1) * segH + segH * 0.12, barW, segH * 0.76, rad * 0.5);
          ctx.fill();
        }
      }
      break;
    }
    case 'dots': {
      const seg = Math.max(4, Math.round(c.height * 40)), segH = bh / seg, r = Math.min(barW, segH) * 0.5;
      for (let i = 0; i < n; i++) {
        const x = -bw / 2 + i * cell + cell / 2, on = Math.max(1, Math.round(lv[i] * seg));
        for (let s = 0; s < on; s++) {
          ctx.fillStyle = c.grad === 'none' ? c.color : c.grad === 'h' ? colorAt(i, 0) : mix(c.color, c.color2, s / Math.max(1, seg - 1));
          ctx.beginPath(); ctx.arc(x, -(s + 0.5) * segH, r, 0, Math.PI * 2); ctx.fill();
          if (c.mirror) { ctx.beginPath(); ctx.arc(x, (s + 0.5) * segH, r, 0, Math.PI * 2); ctx.fill(); }
        }
      }
      break;
    }
    case 'line':
    case 'area':
    case 'wave': {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push([-bw / 2 + (n > 1 ? i / (n - 1) : 0.5) * bw, lv[i] * bh]);
      const path = (sign, rev) => {
        const p = rev ? [...pts].reverse() : pts;
        ctx.moveTo(p[0][0], -sign * p[0][1]);
        for (let i = 1; i < p.length - 1; i++) { const xm = (p[i][0] + p[i + 1][0]) / 2, ym = -sign * (p[i][1] + p[i + 1][1]) / 2; ctx.quadraticCurveTo(p[i][0], -sign * p[i][1], xm, ym); }
        ctx.lineTo(p[p.length - 1][0], -sign * p[p.length - 1][1]);
      };
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const lw = Math.max(1.5, c.thick * S);
      if (c.style === 'line') {
        ctx.strokeStyle = fillFor(-bh, 0); ctx.lineWidth = lw;
        ctx.beginPath(); path(1, false); ctx.stroke();
        if (c.mirror) { ctx.beginPath(); path(-1, false); ctx.stroke(); }
      } else if (c.style === 'area') {
        const f = fillFor(-bh, 0);
        ctx.fillStyle = f; ctx.globalAlpha = alpha * 0.55;
        ctx.beginPath(); path(1, false); ctx.lineTo(bw / 2, 0); ctx.lineTo(-bw / 2, 0); ctx.closePath(); ctx.fill();
        if (c.mirror) { ctx.beginPath(); path(-1, false); ctx.lineTo(bw / 2, 0); ctx.lineTo(-bw / 2, 0); ctx.closePath(); ctx.fill(); }
        ctx.globalAlpha = alpha; ctx.strokeStyle = f; ctx.lineWidth = lw;
        ctx.beginPath(); path(1, false); ctx.stroke();
        if (c.mirror) { ctx.beginPath(); path(-1, false); ctx.stroke(); }
      } else {
        const q = ctx.createLinearGradient(0, -bh, 0, bh);
        q.addColorStop(0, c.grad === 'none' ? c.color : c.color2); q.addColorStop(0.5, c.color); q.addColorStop(1, c.grad === 'none' ? c.color : c.color2);
        ctx.fillStyle = c.grad === 'h' ? hgrad() : q;
        for (const sg of [1, -1]) { ctx.beginPath(); path(sg, false); ctx.lineTo(bw / 2, 0); ctx.lineTo(-bw / 2, 0); ctx.closePath(); ctx.fill(); }
      }
      break;
    }
    case 'circle': {
      const R = c.radius * S, len = c.height * S * 1.6;
      const cw = (2 * Math.PI * R) / n * (1 - c.gap);
      ctx.lineCap = c.round ? 'round' : 'butt';
      ctx.lineWidth = Math.max(1.5, cw);
      for (let i = 0; i < n; i++) {
        const lvi = lv[Math.min(n - 1, 2 * Math.min(i, n - 1 - i))];
        const a = (i / n) * Math.PI * 2 + Math.PI / 2, d = Math.max(min * 0.5, lvi * len);
        ctx.strokeStyle = colorAt(i, lvi);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R + d), Math.sin(a) * (R + d)); ctx.stroke();
        if (c.mirror) { ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R - d * 0.6), Math.sin(a) * (R - d * 0.6)); ctx.stroke(); }
      }
      break;
    }
    case 'ring': {
      const R = c.radius * S, len = c.height * S * 1.6;
      const pts = [];
      for (let i = 0; i < n; i++) {
        // simétrico izquierda/derecha para que cierre sin salto
        const v = lv[Math.min(n - 1, 2 * Math.min(i, n - 1 - i))];
        const a = (i / n) * Math.PI * 2 + Math.PI / 2, r = R + v * len;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, v, i]);
      }
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const s0 = m(pts[n - 1], pts[0]);
      ctx.moveTo(s0[0], s0[1]);
      for (let i = 0; i < n; i++) { const nx = pts[(i + 1) % n], md = m(pts[i], nx); ctx.quadraticCurveTo(pts[i][0], pts[i][1], md[0], md[1]); }
      ctx.closePath();
      const gr = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R + len);
      gr.addColorStop(0, c.color); gr.addColorStop(1, c.grad === 'none' ? c.color : c.color2);
      ctx.fillStyle = gr; ctx.globalAlpha = alpha * 0.28; ctx.fill();
      ctx.globalAlpha = alpha; ctx.strokeStyle = c.grad === 'none' ? c.color : gr; ctx.lineWidth = Math.max(1.5, c.thick * S); ctx.stroke();
      break;
    }
    default: break;
  }
  ctx.restore();
  return true;
}

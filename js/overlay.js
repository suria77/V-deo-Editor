// Capa 2D: partículas (sin estado, deterministas → perfectas al saltar por la línea de tiempo) y texto animado.
import { PARTICLES } from './presets.js';
import { bus } from './state.js';
import { animClip } from './kf.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const textBounds = new Map();
const ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const backOut = (x) => { x = clamp(x, 0, 1); const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const fract = (x) => x - Math.floor(x);
const rnd = (i, k, seed) => fract(Math.sin(i * 127.1 + k * 311.7 + seed * 74.7) * 43758.5453123);

function hexRgb(h) {
  const v = parseInt((h || '#ffffff').slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const mixRgb = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// sprites suaves cacheados
const spriteCache = new Map();
function sprite(rgb) {
  const key = rgb.join(',');
  let s = spriteCache.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 128;
  const g = s.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, css(rgb, 1));
  gr.addColorStop(0.25, css(rgb, 0.6));
  gr.addColorStop(0.6, css(rgb, 0.15));
  gr.addColorStop(1, css(rgb, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  spriteCache.set(key, s);
  return s;
}
function blob(ctx, rgb, x, y, w, h, a) {
  if (a <= 0.003) return;
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.drawImage(sprite(rgb), x - w / 2, y - h / 2, w, h);
}

// ---------------- Partículas ----------------
const PAL = [[255, 80, 120], [255, 200, 60], [90, 200, 255], [140, 255, 140], [200, 120, 255], [255, 255, 255]];

function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.9, y - s * 0.2, x - s * 0.45, y - s * 0.95, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 0.95, x + s * 0.9, y - s * 0.2, x, y + s * 0.35);
  ctx.closePath();
}

function star4(ctx, x, y, s, rgb, a, thin = 0.18) {
  if (a <= 0.003 || s < 0.5) return;
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.fillStyle = css(rgb, 1);
  ctx.beginPath();
  ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s * thin, y); ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s * thin, y); ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x, y, x, y + s * thin); ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y - s * thin); ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.fill();
}
// destello con cruz larga y fina (lens flare)
function flare(ctx, x, y, len, rgb, a) {
  if (a <= 0.003) return;
  ctx.globalAlpha = clamp(a, 0, 1);
  const gh = ctx.createLinearGradient(x - len, y, x + len, y);
  gh.addColorStop(0, css(rgb, 0)); gh.addColorStop(0.5, css(rgb, 1)); gh.addColorStop(1, css(rgb, 0));
  ctx.fillStyle = gh; ctx.fillRect(x - len, y - 1.2, len * 2, 2.4);
  const gv = ctx.createLinearGradient(x, y - len * 0.7, x, y + len * 0.7);
  gv.addColorStop(0, css(rgb, 0)); gv.addColorStop(0.5, css(rgb, 1)); gv.addColorStop(1, css(rgb, 0));
  ctx.fillStyle = gv; ctx.fillRect(x - 1.2, y - len * 0.7, 2.4, len * 1.4);
}
function starPoly(ctx, x, y, n, ro, ri, rot) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri, a = rot + (i * Math.PI) / n - Math.PI / 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function particles(ctx, c, t, lt, W, H, g) {
  const id = c.fx, I = c.intensity, sp = c.speed, sz = c.size, seed = c.seed;
  const S = Math.min(W, H) / 1080;
  const base = hexRgb(c.color);
  const tt = lt + 3.7; // desfase para que no empiece "vacío"
  const T = tt * sp;
  const N = (n) => Math.max(1, Math.floor(n * I));
  ctx.globalCompositeOperation = PARTICLES.find((p) => p.id === id)?.add ? 'lighter' : 'source-over';
  switch (id) {

    case 'radiant': {
      const pulse = 0.78 + 0.22 * Math.sin(T * 1.3);
      const cx = W * 0.5, cy = H * 0.3;
      const white = mixRgb(base, [255, 255, 255], 0.7);
      blob(ctx, base, cx, cy, W * 2.4 * sz, W * 2.4 * sz, 0.32 * I * g * pulse);
      blob(ctx, white, cx, cy, W * 0.9 * sz, W * 0.9 * sz, 0.5 * I * g * pulse);
      blob(ctx, white, cx, cy, W * 0.25 * sz, W * 0.25 * sz, 0.8 * I * g * pulse);
      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2 + T * 0.1 * (i % 2 ? 1 : -0.7) + rnd(i, 1, seed);
        const len = H * (0.55 + 0.4 * rnd(i, 2, seed)) * sz, wd = (30 + 70 * rnd(i, 3, seed)) * S * sz;
        const a = (0.1 + 0.2 * Math.pow(Math.sin(T * 0.8 + i * 1.7), 2)) * I * g;
        ctx.save(); ctx.rotate(ang);
        const gr = ctx.createLinearGradient(0, 0, len, 0);
        gr.addColorStop(0, css(white, 1)); gr.addColorStop(1, css(base, 0));
        ctx.globalAlpha = a; ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, -wd); ctx.lineTo(len, wd); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      for (let i = 0; i < N(70); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r4 = rnd(i, 4, seed);
        const life = 1.2 + r1 * 2;
        const q = T / life + r2, cyc = Math.floor(q), u = fract(q);
        const ang = rnd(i, 5 + cyc, seed) * 6.283, rad = (0.05 + 0.55 * Math.pow(rnd(i, 6 + cyc, seed), 0.7)) * H * 0.55;
        const x = cx + Math.cos(ang) * rad * 0.9, y = cy + Math.sin(ang) * rad;
        const tw = Math.pow(Math.sin(u * Math.PI), 2);
        star4(ctx, x, y, (14 + 40 * r4) * S * sz * tw, white, tw * g * 0.95);
      }
      break;
    }
    case 'constellation': {
      const n = N(40), pts = [];
      for (let i = 0; i < n; i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        pts.push({
          x: W * (0.06 + 0.88 * (0.5 + 0.5 * Math.sin(T * 0.11 * (0.6 + r1) + r2 * 6.283))),
          y: H * (0.06 + 0.88 * (0.5 + 0.5 * Math.sin(T * 0.09 * (0.6 + r3) + r4 * 6.283))),
          r4, tw: 0.55 + 0.45 * Math.sin(T * 2.4 * (0.5 + r1) + r2 * 40),
        });
      }
      const D = Math.max(W, H) * 0.2 * sz;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy);
          if (d < D) {
            ctx.globalAlpha = Math.pow(1 - d / D, 1.2) * 0.75 * I * g;
            ctx.strokeStyle = css(base, 1);
            ctx.lineWidth = 2.2 * S;
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        const s = (22 + 40 * p.r4) * S * sz;
        blob(ctx, base, p.x, p.y, s, s, 0.7 * p.tw * g);
        blob(ctx, [255, 255, 255], p.x, p.y, s * 0.3, s * 0.3, p.tw * g);
        if (p.r4 > 0.72) star4(ctx, p.x, p.y, s * 1.1 * p.tw, [255, 255, 255], 0.9 * g);
      }
      break;
    }
    case 'winter': {
      const palette = [mixRgb(base, [255, 255, 255], 0.35), base, [255, 150, 90], [255, 235, 190], [160, 210, 255]];
      for (let i = 0; i < 9; i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed);
        const x = W * fract(r1 + T * 0.004 * (r3 - 0.5)), y = H * (0.1 + 0.7 * r2);
        blob(ctx, base, x, y, 300 * S * sz, 300 * S * sz, 0.06 * I * g);
      }
      const strands = [[0.04, 0.17, 0.5], [0.12, 0.25, 0.42], [0.2, 0.33, 0.36]];
      strands.forEach(([yl, yr, sag], si) => {
        const nb = 13;
        ctx.globalAlpha = 0.28 * g; ctx.strokeStyle = css(base, 1); ctx.lineWidth = 2 * S;
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) {
          const t = k / 40, x = -0.03 * W + t * 1.06 * W, y = H * ((yl + (yr - yl) * t) + sag * 0.16 * 4 * t * (1 - t) * 0.5);
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        for (let k = 0; k < nb; k++) {
          const t = (k + 0.5) / nb, x = -0.03 * W + t * 1.06 * W, y = H * ((yl + (yr - yl) * t) + sag * 0.16 * 4 * t * (1 - t) * 0.5);
          const col = palette[(k + si * 2) % palette.length];
          const r = rnd(k, 3 + si, seed);
          const tw = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(T * 2.2 * (0.6 + r * 0.8) + k * 2.1 + si), 2);
          const s = (90 + 40 * r) * S * sz;
          blob(ctx, col, x, y + 24 * S, s * 1.6, s * 1.6, 0.42 * tw * I * g);
          blob(ctx, [255, 255, 255], x, y + 24 * S, s * 0.35, s * 0.35, tw * I * g);
          star4(ctx, x, y + 24 * S, s * 0.5 * tw, [255, 255, 255], 0.55 * tw * I * g);
        }
      });
      for (let i = 0; i < N(50); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 7 + r1 * 6, u = fract(T / life + r2);
        blob(ctx, [255, 255, 255], W * (r3 + 0.03 * Math.sin(u * 20 + r4 * 6)), H * (u * 1.1 - 0.05), (8 + r4 * 16) * S * sz, (8 + r4 * 16) * S * sz, 0.6 * g);
      }
      break;
    }
    case 'stellar': {
      const white = [255, 255, 255];
      for (let i = 0; i < N(190); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const tw = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(T * (1 + 3 * r1) + r2 * 60), 2);
        const s = (5 + 14 * r4 * r4) * S * sz;
        blob(ctx, r4 > 0.8 ? base : white, W * r3, H * r2, s, s, (0.35 + 0.65 * r4) * tw * g);
      }
      for (let i = 0; i < 9; i++) {
        const r1 = rnd(i, 11, seed), r2 = rnd(i, 12, seed), r3 = rnd(i, 13, seed);
        const tw = 0.4 + 0.6 * Math.pow(Math.sin(T * (0.7 + r3) + i * 3), 2);
        const x = W * (0.08 + 0.84 * r1), y = H * (0.06 + 0.8 * r2), s = (40 + 70 * r3) * S * sz;
        blob(ctx, base, x, y, s * 2.4, s * 2.4, 0.5 * tw * g);
        flare(ctx, x, y, s * 2.2, white, 0.55 * tw * g);
        star4(ctx, x, y, s * tw, white, g);
      }
      const per = 3.4 / sp;
      const cyc = Math.floor((tt) / per), u = fract(tt / per) / 0.32;
      if (u >= 0 && u < 1 && rnd(cyc, 21, seed) > 0.3) {
        const x0 = W * (0.05 + 0.7 * rnd(cyc, 22, seed)), y0 = H * (0.03 + 0.35 * rnd(cyc, 23, seed));
        const dx = 0.5 * W, dy = 0.34 * H;
        const hx = x0 + dx * u, hy = y0 + dy * u;
        const tail = ctx.createLinearGradient(hx, hy, hx - dx * 0.35, hy - dy * 0.35);
        tail.addColorStop(0, css(white, 1)); tail.addColorStop(1, css(base, 0));
        ctx.globalAlpha = Math.sin(u * Math.PI) * g; ctx.strokeStyle = tail; ctx.lineWidth = 5 * S; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - dx * 0.35, hy - dy * 0.35); ctx.stroke();
        blob(ctx, white, hx, hy, 60 * S, 60 * S, Math.sin(u * Math.PI) * g);
      }
      break;
    }
    case 'spotlight': {
      const sway = Math.sin(T * 0.3) * 0.08;
      const sx = W * (0.5 + sway), topW = 50 * S * sz, botW = W * 0.62 * sz, yb = H * 0.9;
      const white = mixRgb(base, [255, 255, 255], 0.6);
      blob(ctx, white, sx, -H * 0.02, W * 0.9, W * 0.45, 0.7 * I * g);
      for (const [k, a] of [[1, 0.26], [0.55, 0.3], [0.22, 0.34]]) {
        const gr = ctx.createLinearGradient(0, 0, 0, yb);
        gr.addColorStop(0, css(white, 1)); gr.addColorStop(0.6, css(base, 0.45)); gr.addColorStop(1, css(base, 0));
        ctx.globalAlpha = a * I * g * (0.9 + 0.1 * Math.sin(T * 1.7 + k));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(sx - topW * k, 0); ctx.lineTo(sx + topW * k, 0);
        ctx.lineTo(sx + botW * k * 0.5, yb); ctx.lineTo(sx - botW * k * 0.5, yb);
        ctx.closePath(); ctx.fill();
      }
      blob(ctx, base, sx, yb, botW * 1.2, botW * 0.34, 0.5 * I * g);
      blob(ctx, white, sx, yb, botW * 0.6, botW * 0.16, 0.5 * I * g);
      for (let i = 0; i < N(90); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const v = fract(r1 + T * 0.03 * (0.3 + r4) * (r3 < 0.5 ? 1 : -1));
        const y = yb * v, half = (topW + (botW * 0.5 - topW) * v) * (2 * r2 - 1) * 0.92;
        const x = sx + half + Math.sin(T * 0.8 + r3 * 20) * 14 * S;
        const tw = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(T * 2 + r4 * 40), 2);
        const s = (8 + 18 * r4) * S * sz;
        blob(ctx, white, x, y, s, s, tw * (1 - v * 0.5) * g);
      }
      break;
    }
    case 'shards': {
      const per = 2.8 / sp;
      const gold = mixRgb(base, [255, 255, 255], 0.3);
      for (let layer = 0; layer < 2; layer++) {
        const q = tt / per + layer * 0.5, cyc = Math.floor(q), u = fract(q);
        const cx = W * (0.25 + 0.5 * rnd(cyc, 31 + layer, seed)), cy = H * (0.22 + 0.35 * rnd(cyc, 32 + layer, seed));
        if (u < 0.18) {
          const f = 1 - u / 0.18;
          blob(ctx, [255, 255, 255], cx, cy, 460 * S * sz * (1 + u * 3), 460 * S * sz * (1 + u * 3), 0.85 * f * I * g);
          blob(ctx, base, cx, cy, 800 * S * sz, 800 * S * sz, 0.35 * f * I * g);
        }
        for (let i = 0; i < N(34); i++) {
          const r1 = rnd(i + layer * 50, 1, seed), r2 = rnd(i + layer * 50, 2, seed), r3 = rnd(i + layer * 50, 3, seed), r4 = rnd(i + layer * 50, 4, seed);
          const ang = r1 * 6.283, spd = (0.18 + 0.55 * r2) * Math.min(W, H) * 1.0 * sz;
          const e = 1 - Math.pow(1 - u, 2.2);
          const x = cx + Math.cos(ang) * spd * e * 1.5, y = cy + Math.sin(ang) * spd * e * 1.5 + 0.28 * H * u * u;
          const a = Math.pow(1 - u, 1.1) * (0.6 + 0.4 * Math.sin(T * 14 + r3 * 40)) * I * g;
          const sz2 = (16 + 46 * r4) * S * sz * (1 - u * 0.55);
          const col = r3 < 0.5 ? gold : r3 < 0.8 ? [255, 255, 255] : mixRgb(base, [255, 150, 200], 0.6);
          blob(ctx, col, x, y, sz2 * 3, sz2 * 3, a * 0.5);
          ctx.globalAlpha = clamp(a, 0, 1);
          ctx.fillStyle = css(col, 1);
          starPoly(ctx, x, y, r4 < 0.5 ? 4 : 5, sz2, sz2 * (r4 < 0.5 ? 0.28 : 0.45), r3 * 6 + u * (3 + r4 * 7));
          ctx.fill();
        }
      }
      break;
    }
    case 'fire': {
      const core = mixRgb(base, [255, 250, 220], 0.75), hot = mixRgb(base, [255, 220, 90], 0.5), mid = base, tail = base.map((v, k) => Math.round(v * (k === 0 ? 0.75 : 0.3)));
      const flick = 0.85 + 0.15 * Math.sin(T * 9.7) * Math.sin(T * 5.3);
      blob(ctx, mid, W / 2, H * 1.02, W * 1.8, H * 0.55 * sz, 0.35 * I * g * flick);
      const tongues = 7;
      for (let i = 0; i < N(340); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 0.7 + r1 * 0.8;
        const u = fract(T / life + r2);
        const tc = (Math.floor(r3 * tongues) + 0.5) / tongues + (rnd(Math.floor(r3 * tongues), 9, seed) - 0.5) * 0.08;
        const spread = (r4 - 0.5) * (0.22 * (1 - u * 0.85));
        const x = W * (tc + spread) + Math.sin(T * 5 + r4 * 30 + u * 6) * 45 * S * u;
        const hgt = (0.28 + 0.35 * rnd(Math.floor(r3 * tongues), 7, seed) + 0.1 * r1) * sz;
        const y = H * 1.05 - u * H * hgt;
        const s = (170 + 170 * r4) * S * sz * (1 - u * 0.75);
        const col = u < 0.12 ? core : u < 0.35 ? hot : u < 0.7 ? mid : tail;
        blob(ctx, col, x, y, s * 0.85, s * 1.35, Math.pow(1 - u, 1.3) * 0.7 * g * flick);
      }
      break;
    }
    case 'embers': {
      const col = mixRgb(base, [255, 255, 255], 0.25);
      for (let i = 0; i < N(150); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 3 + r1 * 3.5;
        const u = fract(T / life + r2);
        const x = W * (r3 + 0.05 * Math.sin(T * 1.4 + r4 * 6.28));
        const y = H * (1.05 - u * 1.2);
        const s = (22 + r4 * 40) * S * sz * (1 - u * 0.5);
        const fl = 0.6 + 0.4 * Math.sin(T * 13 + r1 * 50);
        blob(ctx, col, x, y, s, s, (1 - u) * fl * g);
        blob(ctx, [255, 240, 200], x, y, s * 0.3, s * 0.3, (1 - u) * fl * g);
      }
      break;
    }
    case 'snow': {
      const col = base;
      for (let i = 0; i < N(220); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 5 + r1 * 6;
        const u = fract(T / life + r2);
        const x = W * (r3 + 0.04 * Math.sin(u * 22 + r4 * 6.28));
        const y = H * (-0.05 + u * 1.1);
        const s = (6 + r4 * 22) * S * sz;
        blob(ctx, col, x, y, s, s, (0.45 + 0.5 * r4) * g);
      }
      break;
    }
    case 'rain': {
      ctx.strokeStyle = css(base, 0.45 * g);
      ctx.lineCap = 'round';
      for (let i = 0; i < N(300); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed);
        const life = 0.45 + r1 * 0.35;
        const u = fract(T / life + r2);
        const x = W * (r3 * 1.25 - 0.1) - u * H * 0.12;
        const y = H * (u * 1.15 - 0.1);
        const len = (60 + r1 * 70) * S * sz;
        ctx.lineWidth = (1.5 + r1 * 2.5) * S * sz;
        ctx.globalAlpha = (0.35 + 0.5 * r2) * g;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * 0.12, y - len); ctx.stroke();
      }
      break;
    }
    case 'sparkles': {
      const col = mixRgb(base, [255, 255, 255], 0.4);
      for (let i = 0; i < N(70); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r4 = rnd(i, 4, seed);
        const life = 0.9 + r1 * 1.6;
        const q = T / life + r2, cyc = Math.floor(q), u = fract(q);
        const x = W * rnd(i, 5 + cyc * 0.37, seed), y = H * rnd(i, 6 + cyc * 0.53, seed);
        const tw = Math.pow(Math.sin(u * Math.PI), 2);
        const s = (22 + 60 * r4) * S * sz * tw;
        blob(ctx, col, x, y, s * 1.6, s * 1.6, 0.5 * tw * g);
        ctx.globalAlpha = tw * g;
        ctx.fillStyle = css(col, 1);
        ctx.beginPath();
        ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s * 0.18, y); ctx.quadraticCurveTo(x, y, x, y + s);
        ctx.quadraticCurveTo(x, y, x - s * 0.18, y); ctx.quadraticCurveTo(x, y, x, y - s);
        ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x, y, x, y + s * 0.18); ctx.quadraticCurveTo(x, y, x + s, y);
        ctx.quadraticCurveTo(x, y, x, y - s * 0.18); ctx.quadraticCurveTo(x, y, x - s, y);
        ctx.fill();
      }
      break;
    }
    case 'dust': {
      for (let i = 0; i < N(170); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 8 + r1 * 8;
        const u = fract(T / life + r2);
        const x = W * (r3 + 0.05 * Math.sin(T * 0.6 + r4 * 6.28));
        const y = H * (1.05 - u * 1.1);
        const s = (16 + r4 * 34) * S * sz;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * 3 + r2 * 50));
        const a = tw * Math.sin(u * Math.PI) * g;
        blob(ctx, base, x, y, s, s, a);
        blob(ctx, [255, 250, 225], x, y, s * 0.28, s * 0.28, a);
      }
      break;
    }
    case 'fog': {
      for (let i = 0; i < 9; i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const x = W * (fract(r1 + T * 0.012 * (0.4 + r2) * (r4 < 0.5 ? 1 : -1) + 0.2) * 1.5 - 0.25);
        const y = H * (0.3 + 0.7 * r3);
        const rad = (0.45 + 0.55 * r4) * H * 0.4 * sz;
        const a = 0.2 * I * (0.65 + 0.35 * Math.sin(T * 0.4 + r1 * 9)) * g;
        blob(ctx, base, x, y, rad * 3, rad * 1.5, a);
      }
      break;
    }
    case 'smoke': {
      for (let i = 0; i < N(46); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 4 + r1 * 3.5;
        const u = fract(T / life + r2);
        const x = W * (0.5 + (r3 - 0.5) * 0.8) + Math.sin(T * 0.8 + r4 * 6.28) * 70 * S * u;
        const y = H * (1.08 - u * 0.8);
        const s = (150 + 320 * u) * S * sz;
        blob(ctx, base, x, y, s, s, Math.sin(u * Math.PI) * 0.3 * I * g);
      }
      break;
    }
    case 'bokeh': {
      for (let i = 0; i < N(28); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const x = W * fract(r1 + T * 0.01 * (r4 - 0.5) * 2 + 1), y = H * fract(r2 - T * 0.012 * (0.3 + r3) + 1);
        const rad = (30 + 120 * r3) * S * sz;
        const col = mixRgb(base, PAL[Math.floor(r4 * 6) % 6], 0.25 * r4);
        const a = (0.14 + 0.14 * Math.sin(T * 0.9 + r4 * 20)) * g;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = css(col, 1);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
        ctx.globalAlpha = Math.max(0, a * 1.8);
        ctx.strokeStyle = css(mixRgb(col, [255, 255, 255], 0.4), 1);
        ctx.lineWidth = 2.5 * S;
        ctx.stroke();
      }
      break;
    }
    case 'rays': {
      ctx.save();
      for (let i = 0; i < 6; i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed);
        const ang = 0.15 + i * 0.16 + Math.sin(T * 0.25 + r1 * 6) * 0.05;
        const wd = (80 + 220 * r2) * S * sz;
        const a = (0.22 + 0.18 * Math.sin(T * 0.5 + r1 * 9)) * I * g;
        ctx.setTransform(ctx.getTransform());
        ctx.save();
        ctx.translate(W * 0.15, -H * 0.08);
        ctx.rotate(-ang + 0.5);
        const gr = ctx.createLinearGradient(0, 0, 0, H * 1.5);
        gr.addColorStop(0, css(base, 1)); gr.addColorStop(1, css(base, 0));
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = gr;
        ctx.fillRect(-wd / 2, 0, wd, H * 1.5);
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    case 'confetti': {
      for (let i = 0; i < N(140); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 3 + r1 * 2.5;
        const u = fract(T / life + r2);
        const x = W * (r3 + 0.05 * Math.sin(u * 8 + r4 * 6.28)), y = H * (-0.05 + u * 1.1);
        const w = (16 + 16 * r4) * S * sz;
        const col = c.color === '#ffffff' ? PAL[Math.floor(r2 * 5)] : mixRgb(base, PAL[Math.floor(r2 * 6) % 6], 0.5);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(T * (2 + 3 * r2) + r1 * 6); ctx.scale(1, Math.cos(T * 5 + r4 * 30));
        ctx.globalAlpha = g; ctx.fillStyle = css(col, 1);
        ctx.fillRect(-w / 2, -w / 4, w, w / 2);
        ctx.restore();
      }
      break;
    }
    case 'hearts': {
      for (let i = 0; i < N(44); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 4 + r1 * 3;
        const u = fract(T / life + r2);
        const x = W * (r3 + 0.04 * Math.sin(T * 1.2 + r4 * 6.28)), y = H * (1.08 - u * 1.2);
        const s = (30 + 60 * r4) * S * sz;
        const col = mixRgb(base, [255, 255, 255], 0.35 * r4);
        ctx.globalAlpha = Math.sin(u * Math.PI) * 0.9 * g; ctx.fillStyle = css(col, 1);
        heartPath(ctx, x, y, s); ctx.fill();
      }
      break;
    }
    case 'petals':
    case 'leaves': {
      const leaf = id === 'leaves';
      for (let i = 0; i < N(60); i++) {
        const r1 = rnd(i, 1, seed), r2 = rnd(i, 2, seed), r3 = rnd(i, 3, seed), r4 = rnd(i, 4, seed);
        const life = 7 + r1 * 5;
        const u = fract(T / life + r2);
        const x = W * (r3 * 1.2 - 0.1) + Math.sin(u * 14 + r4 * 6.28) * 60 * S, y = H * (-0.06 + u * 1.12);
        const w = (24 + 30 * r4) * S * sz;
        const col = mixRgb(base, leaf ? [190, 150, 60] : [255, 255, 255], 0.35 * r4);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(T * (0.6 + r2) + r1 * 6); ctx.scale(1, 0.4 + 0.6 * Math.abs(Math.cos(T * 1.6 + r3 * 20)));
        ctx.globalAlpha = 0.9 * g; ctx.fillStyle = css(col, 1);
        ctx.beginPath(); ctx.ellipse(0, 0, w, w * 0.5, 0, 0, 7); ctx.fill();
        if (leaf) { ctx.strokeStyle = css(col.map((v) => v * 0.6), 1); ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.stroke(); }
        ctx.restore();
      }
      break;
    }
    default: break;
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------- Texto ----------------
const fontReq = new Set();
export function ensureFont(font, weight, italic) {
  const key = `${italic ? 'i' : 'n'}${weight} ${font}`;
  if (fontReq.has(key) || !document.fonts) return;
  fontReq.add(key);
  document.fonts.load(`${italic ? 'italic ' : ''}${weight} 48px "${font}"`).then(() => bus.emit('fontloaded')).catch(() => {});
}

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function layoutText(ctx, c, px, W) {
  const raw = c.upper ? c.text.toUpperCase() : c.text;
  const maxW = c.width * W;
  const lines = [];
  for (const para of raw.split('\n')) {
    const words = para.split(' ');
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      const tw = ctx.measureText(test).width + c.spacing * px * test.length;
      if (tw > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    lines.push(cur);
  }
  return lines;
}

export function drawText(ctx, c, lt, W, H) {
  const px = Math.max(8, c.size * H);
  ensureFont(c.font, c.weight, c.italic);
  ctx.font = `${c.italic ? 'italic ' : ''}${c.weight} ${px}px "${c.font}", "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const sp = (c.spacing || 0) * px;
  const lh = px * c.lineHeight;
  const lines = layoutText(ctx, c, px, W);
  const glyphs = [];
  let maxLW = 0, wordBase = 0;
  lines.forEach((line, li) => {
    let wk = 0;
    const lw = ctx.measureText(line).width + sp * Math.max(0, line.length - 1);
    maxLW = Math.max(maxLW, lw);
    const startX = c.align === 'left' ? -c.width * W / 2 : c.align === 'right' ? c.width * W / 2 - lw : -lw / 2;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === ' ') { wk++; continue; }
      glyphs.push({ wi: wordBase + wk, ch, x: startX + ctx.measureText(line.slice(0, i)).width + i * sp, w: ctx.measureText(ch).width, y: (li - (lines.length - 1) / 2) * lh });
    }
    if (line.trim()) wordBase += wk + 1;
  });
  const n = glyphs.length;
  if (!n) return false;
  let kActive = -1;
  if (c.karaoke && c.words && c.words.length) {
    for (let i = 0; i < c.words.length; i++) { if (lt >= c.words[i].s - 0.02) kActive = i; else break; }
  }
  const inA = c.inAnim, outA = c.outAnim, lp = c.loop;
  const pIn = inA.type === 'none' ? 1 : clamp(lt / Math.max(0.05, inA.dur), 0, 1);
  const qOut = outA.type === 'none' ? 1 : clamp((c.dur - lt) / Math.max(0.05, outA.dur), 0, 1);
  const eI = ease(pIn), eO = ease(qOut);
  let alpha = c.opacity ?? 1, dx = 0, dy = 0, scale = 1, glowMul = 1;
  switch (inA.type) {
    case 'fade': alpha *= eI; break;
    case 'slideUp': alpha *= eI; dy += (1 - eI) * 0.07 * H; break;
    case 'slideDown': alpha *= eI; dy -= (1 - eI) * 0.07 * H; break;
    case 'slideLeft': alpha *= eI; dx -= (1 - eI) * 0.35 * W; break;
    case 'slideRight': alpha *= eI; dx += (1 - eI) * 0.35 * W; break;
    case 'pop': alpha *= clamp(pIn * 4, 0, 1); scale *= backOut(pIn); break;
    case 'zoomOut': alpha *= eI; scale *= 1 + (1 - eI) * 1.6; break;
    case 'glow': alpha *= eI; glowMul += (1 - eI) * 3; break;
    default: break;
  }
  switch (outA.type) {
    case 'fade': alpha *= eO; break;
    case 'slideDown': alpha *= eO; dy += (1 - eO) * 0.07 * H; break;
    case 'slideUp': alpha *= eO; dy -= (1 - eO) * 0.07 * H; break;
    case 'zoomIn': alpha *= eO; scale *= 1 + (1 - eO) * 0.8; break;
    case 'shrink': alpha *= eO; scale *= 0.3 + 0.7 * eO; break;
    case 'lettersFade': break;
    default: break;
  }
  const A = lp.amount;
  switch (lp.type) {
    case 'float': dy += Math.sin(lt * 2.2) * 0.012 * H * A * 2; break;
    case 'pulse': scale *= 1 + 0.06 * A * Math.sin(lt * 5); break;
    case 'shake': dx += (Math.sin(lt * 70) + Math.sin(lt * 43)) * 0.004 * W * A * 2; dy += (Math.sin(lt * 61) + Math.sin(lt * 37)) * 0.003 * H * A * 2; break;
    case 'glowPulse': glowMul += (0.5 + 0.5 * Math.sin(lt * 3)) * 2.5 * A; break;
    default: break;
  }
  const cx = W * (0.5 + c.x * 0.5) + dx, cy = H * (0.5 + c.y * 0.5) + dy;
  if (ctx.canvas.width === W) textBounds.set(c.id, { cx, cy, w: (maxLW + px * 0.7) * scale, h: (lines.length * lh + px * 0.3) * scale, rot: (c.rot * Math.PI) / 180, a: alpha });
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((c.rot * Math.PI) / 180);
  ctx.scale(scale, scale);
  if (c.bg.on) {
    const padX = px * 0.45, padY = px * 0.25;
    const bw = maxLW + padX * 2, bh = lines.length * lh + padY * 2 - (lh - px);
    ctx.globalAlpha = clamp(alpha, 0, 1) * c.bg.alpha;
    ctx.fillStyle = c.bg.color;
    rrect(ctx, -bw / 2, -bh / 2, bw, bh, px * 0.25);
    ctx.fill();
  }
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  glyphs.forEach((g, gi) => {
    let a = alpha, gdx = 0, gdy = 0, gs = 1;
    const frac = gi / Math.max(1, n - 1);
    switch (inA.type) {
      case 'typewriter': if (gi >= Math.floor(pIn * n + 0.0001) && pIn < 1) a = 0; break;
      case 'lettersRise': { const gp = clamp((pIn - frac * 0.6) / 0.4, 0, 1); a *= ease(gp); gdy += (1 - ease(gp)) * 0.05 * H; break; }
      case 'lettersFade': { const gp = clamp((pIn - frac * 0.75) / 0.25, 0, 1); a *= gp; break; }
      case 'lettersPop': { const gp = clamp((pIn - frac * 0.6) / 0.4, 0, 1); a *= clamp(gp * 4, 0, 1); gs *= backOut(gp); break; }
      default: break;
    }
    if (outA.type === 'lettersFade') { const gp = clamp((qOut - (1 - frac) * 0.75) / 0.25, 0, 1); a *= gp; }
    if (lp.type === 'wave') gdy += Math.sin(lt * 5 + gi * 0.6) * 0.012 * H * A * 2;
    if (a <= 0.003) return;
    ctx.save();
    ctx.translate(g.x + g.w / 2 + gdx, g.y + gdy);
    ctx.scale(gs, gs);
    if (kActive >= 0 && g.wi === kActive) ctx.scale(1.07, 1.07);
    ctx.globalAlpha = clamp(a, 0, 1);
    let fill = c.color;
    const kOn = kActive >= 0 && g.wi === kActive;
    if (lp.type === 'rainbow') fill = `hsl(${(gi * 24 + lt * 200 * A) % 360},90%,62%)`;
    else if (kOn) fill = c.karaoke.color || '#ffd23f';
    else if (c.color2) { const gr = ctx.createLinearGradient(0, -px * 0.5, 0, px * 0.5); gr.addColorStop(0, c.color); gr.addColorStop(1, c.color2); fill = gr; }
    const sb = c.shadow.blur * px * 0.4 * glowMul;
    const hasStroke = c.stroke.w > 0;
    if (hasStroke) {
      ctx.lineWidth = c.stroke.w * H * 2;
      ctx.strokeStyle = c.stroke.color;
      ctx.shadowColor = c.shadow.color; ctx.shadowBlur = sb;
      ctx.strokeText(g.ch, -g.w / 2, 0);
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    } else {
      ctx.shadowColor = c.shadow.color; ctx.shadowBlur = sb;
      if (glowMul > 1.01 || sb > 0) { ctx.shadowOffsetY = c.shadow.blur > 0 && glowMul <= 1.01 ? px * 0.03 : 0; }
    }
    ctx.fillStyle = fill;
    ctx.fillText(g.ch, -g.w / 2, 0);
    ctx.restore();
  });
  ctx.restore();
  return true;
}

// ---------------- Gestor de capas ----------------
function mk() { const cv = document.createElement('canvas'); return { cv, ctx: cv.getContext('2d') }; }

export class Overlay {
  constructor() {
    this.n = mk(); this.a = mk(); this.tx = mk();
    this.W = 0; this.H = 0;
  }
  ensure(W, H) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    const pw = Math.round(W / 2), ph = Math.round(H / 2);
    this.n.cv.width = this.a.cv.width = pw; this.n.cv.height = this.a.cv.height = ph;
    this.tx.cv.width = W; this.tx.cv.height = H;
  }
  draw(project, t, W, H) {
    this.ensure(W, H);
    const act = project.clips.filter((c) => (c.type === 'fx' || c.type === 'text') && t >= c.start - 1e-6 && t < c.start + c.dur).map((c) => animClip(c, t - c.start));
    const post = postParams(act, t);
    let usedN = false, usedA = false, usedT = false;
    const parts = act.filter((c) => c.type === 'fx' && c.kind === 'particles').sort((a, b) => a.start - b.start);
    if (parts.length) {
      this.n.ctx.setTransform(1, 0, 0, 1, 0, 0); this.n.ctx.clearRect(0, 0, this.n.cv.width, this.n.cv.height);
      this.a.ctx.setTransform(1, 0, 0, 1, 0, 0); this.a.ctx.clearRect(0, 0, this.a.cv.width, this.a.cv.height);
      for (const c of parts) {
        const def = PARTICLES.find((p) => p.id === c.fx);
        if (!def) continue;
        const target = def.add ? this.a : this.n;
        target.ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
        const lt = t - c.start;
        const g = Math.min(1, lt / Math.max(0.01, c.fade), (c.dur - lt) / Math.max(0.01, c.fade));
        particles(target.ctx, c, t, lt, W, H, clamp(g, 0, 1));
        if (def.add) usedA = true; else usedN = true;
      }
    }
    textBounds.clear();
    const texts = act.filter((c) => c.type === 'text').sort((a, b) => a.start - b.start);
    if (texts.length) {
      this.tx.ctx.setTransform(1, 0, 0, 1, 0, 0); this.tx.ctx.clearRect(0, 0, W, H);
      for (const c of texts) { if (drawText(this.tx.ctx, c, t - c.start, W, H)) usedT = true; }
    }
    return { normal: usedN ? this.n.cv : null, add: usedA ? this.a.cv : null, text: usedT ? this.tx.cv : null, post };
  }
}

export function postParams(act, t) {
  const p = { glitch: 0, rgb: 0, vhs: 0, grain: 0, flash: 0, zoom: 1, blur: 0, pixel: 0, mirror: 0, bw: 0, sepia: 0, vig: 0, glow: 0, shake: [0, 0] };
  for (const c of act) {
    if (c.type !== 'fx' || c.kind !== 'post') continue;
    const lt = t - c.start;
    const g = clamp(Math.min(1, lt / Math.max(0.01, c.fade), (c.dur - lt) / Math.max(0.01, c.fade)), 0, 1);
    const I = c.intensity * g;
    switch (c.fx) {
      case 'glitch': p.glitch = Math.max(p.glitch, I); break;
      case 'rgb': p.rgb = Math.max(p.rgb, I); break;
      case 'vhs': p.vhs = Math.max(p.vhs, I); break;
      case 'grain': p.grain = Math.max(p.grain, I); break;
      case 'shake': p.shake[0] += Math.sin(t * 61 * c.speed) * 0.008 * I; p.shake[1] += Math.sin(t * 53 * c.speed + 1) * 0.008 * I; p.zoom *= 1 + 0.03 * I; break;
      case 'flash': p.flash = Math.max(p.flash, Math.exp(-fract(t * 1.6 * c.speed) * 7) * 0.7 * I); break;
      case 'pulse': p.zoom *= 1 + Math.pow(Math.abs(Math.sin(t * Math.PI * 2 * c.speed)), 6) * 0.1 * I; break;
      case 'blur': p.blur = Math.max(p.blur, I); break;
      case 'pixel': p.pixel = Math.max(p.pixel, I); break;
      case 'mirror': p.mirror = g > 0.5 ? 1 : 0; break;
      case 'bw': p.bw = Math.max(p.bw, I * (c.intensity >= 1 ? 1 : 1)); break;
      case 'sepia': p.sepia = Math.max(p.sepia, I); break;
      case 'vignette': p.vig = Math.max(p.vig, I); break;
      case 'glow': p.glow = Math.max(p.glow, I); break;
      default: break;
    }
  }
  return p;
}

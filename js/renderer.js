import { animClip } from './kf.js';
import { xfadeAt } from './xfade.js';
// Motor de composición WebGL2: capas de vídeo/imagen con color, chroma, máscaras, transiciones
// + superposición 2D (texto y partículas) + post-proceso (glitch, VHS, etc.)
import { FILTERS, ADJ_DEFAULT } from './presets.js';

const VS_LAYER = `#version 300 es
uniform vec2 uRes; uniform vec2 uCenter; uniform vec2 uSize; uniform float uRot;
out vec2 vLocal;
void main(){
  vec2 q[4] = vec2[4](vec2(-.5,-.5),vec2(.5,-.5),vec2(-.5,.5),vec2(.5,.5));
  vec2 p = q[gl_VertexID];
  vLocal = p;
  vec2 l = p*uSize;
  float c = cos(uRot), s = sin(uRot);
  vec2 r = vec2(l.x*c - l.y*s, l.x*s + l.y*c);
  vec2 px = uCenter + r;
  gl_Position = vec4(px.x/uRes.x*2.-1., 1.-px.y/uRes.y*2., 0., 1.);
}`;

const FS_LAYER = `#version 300 es
precision highp float;
in vec2 vLocal; out vec4 outColor;
uniform sampler2D uTex;
uniform float uOpacity; uniform vec4 uCrop; uniform vec2 uFlip;
uniform int uMask; uniform float uMaskSize; uniform float uMaskFeather; uniform float uAspect;
uniform float uLod; uniform vec3 uWipe; uniform float uFlash; uniform float uDim;
uniform int uKeyOn; uniform vec3 uKey; uniform vec2 uKeyP;
uniform vec4 uA1; uniform vec4 uA2; uniform vec4 uA3; uniform float uTime; uniform vec2 uRes;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
vec3 rgb2yuv(vec3 c){ return vec3(dot(c, vec3(.299,.587,.114)), dot(c, vec3(-.14713,-.28886,.436)), dot(c, vec3(.615,-.51499,-.10001))); }
vec3 hueRot(vec3 c, float a){
  float cs = cos(a), sn = sin(a);
  mat3 m = mat3(
    .299+.701*cs+.168*sn, .587-.587*cs+.330*sn, .114-.114*cs-.497*sn,
    .299-.299*cs-.328*sn, .587+.413*cs+.035*sn, .114-.114*cs+.292*sn,
    .299-.3*cs+1.25*sn,   .587-.588*cs-1.05*sn, .114+.886*cs-.203*sn);
  return clamp(c*m, 0., 1.);
}
vec4 samp(vec2 uv){
  if (uLod > 0.01) {
    vec2 ts = 1.0 / vec2(textureSize(uTex, 0));
    float k = exp2(uLod) * 0.6;
    vec4 a = textureLod(uTex, uv, uLod) * 0.4;
    a += textureLod(uTex, uv + vec2( k, k) * ts, uLod) * 0.15;
    a += textureLod(uTex, uv + vec2(-k, k) * ts, uLod) * 0.15;
    a += textureLod(uTex, uv + vec2( k,-k) * ts, uLod) * 0.15;
    a += textureLod(uTex, uv + vec2(-k,-k) * ts, uLod) * 0.15;
    return a;
  }
  return texture(uTex, uv);
}
void main(){
  vec2 l = vLocal + 0.5; // 0..1, y hacia abajo
  if (l.x < uCrop.x || l.x > 1.-uCrop.y || l.y < uCrop.z || l.y > 1.-uCrop.w) discard;
  float alpha = uOpacity;
  // cortinilla
  if (uWipe.z < 0.999) {
    float w = dot(vLocal, uWipe.xy) + 0.5;
    alpha *= 1. - smoothstep(uWipe.z - 0.02, uWipe.z + 0.02, w);
    if (uWipe.z <= 0.0) discard;
  }
  // máscara
  vec2 cc = vec2((uCrop.x + 1.-uCrop.y)*.5, (uCrop.z + 1.-uCrop.w)*.5);
  vec2 cs = vec2(1.-uCrop.x-uCrop.y, 1.-uCrop.z-uCrop.w);
  vec2 m = (l - cc) / cs; // -0.5..0.5
  if (uMask > 0) {
    vec2 q = vec2(m.x*uAspect, m.y);
    float mk = 1.;
    float r0 = 0.5*min(uAspect,1.)*uMaskSize;
    float f = max(uMaskFeather, 0.002);
    if (uMask == 1) { float d = length(q) - r0; mk = smoothstep(0., f*r0, -d); }
    else if (uMask == 2) { vec2 b = vec2(0.5*uAspect,0.5)*uMaskSize; float rad = 0.22*min(b.x,b.y); vec2 dd = abs(q)-b+rad; float d = length(max(dd,0.))+min(max(dd.x,dd.y),0.)-rad; mk = smoothstep(0., f*min(b.x,b.y), -d); }
    else if (uMask == 3) { float d = length(m / (0.5*uMaskSize)) - 1.; mk = smoothstep(0., f*2., -d); }
    else if (uMask == 4) { mk = clamp(1. - (m.y + 0.5 - (1.-uMaskSize*0.6))/(0.6*uMaskSize*max(f*3.,0.2)+0.001), 0., 1.); }
    else if (uMask == 5) { mk = clamp(1. - ((0.5 - m.y) - (1.-uMaskSize*0.6))/(0.6*uMaskSize*max(f*3.,0.2)+0.001), 0., 1.); }
    else if (uMask == 6) { float e = 0.5 - abs(m.x); mk = clamp(e/(0.5*max(f*2.,0.05)*uMaskSize + 0.001), 0., 1.); }
    alpha *= mk;
  }
  vec2 uv = vec2(l.x, 0.5 - vLocal.y);
  if (uFlip.x < 0.) uv.x = 1. - uv.x;
  if (uFlip.y < 0.) uv.y = 1. - uv.y;
  vec4 t = samp(uv);
  vec3 c = t.rgb; alpha *= t.a;
  // chroma
  if (uKeyOn == 1) {
    vec3 yk = rgb2yuv(uKey), yc = rgb2yuv(c);
    float lk = max(length(yk.yz), 1e-3), lc = length(yc.yz);
    // diferencia de tono (ángulo de crominancia) + falta de saturación respecto a la clave
    float ang = lc < 0.015 ? 1.0 : 1. - dot(yc.yz / lc, yk.yz / lk);
    float d = ang * 2.2 + max(0., 0.4 - lc / lk) * 1.2;
    float a2 = smoothstep(uKeyP.x, uKeyP.x + uKeyP.y + 0.001, d);
    alpha *= a2;
    // quitar el reflejo de color en los bordes
    float lum = dot(c, vec3(.299,.587,.114));
    c = mix(mix(vec3(lum), c, 0.35), c, smoothstep(0., 1., a2));
  }
  // sharpen
  if (uA3.w > 0.001 && uLod < 0.01) {
    vec2 ts = 1.0 / vec2(textureSize(uTex, 0));
    vec3 n = texture(uTex, uv + vec2(ts.x,0.)).rgb + texture(uTex, uv - vec2(ts.x,0.)).rgb + texture(uTex, uv + vec2(0.,ts.y)).rgb + texture(uTex, uv - vec2(0.,ts.y)).rgb;
    c += (c*4. - n) * uA3.w * 0.6;
  }
  // color
  c *= exp2(uA1.x);
  c += uA1.y * 0.4;
  c = (c - 0.5) * (1. + uA1.z) + 0.5;
  c.r += uA2.x * 0.12; c.b -= uA2.x * 0.12;
  c.g -= uA2.y * 0.10; c.r += uA2.y * 0.04; c.b += uA2.y * 0.04;
  float lu = dot(c, vec3(.299,.587,.114));
  c += uA3.x * 0.25 * smoothstep(.45, 1., lu);
  c += uA3.y * 0.25 * (1. - smoothstep(0., .55, lu));
  lu = dot(c, vec3(.299,.587,.114));
  c = mix(vec3(lu), c, 1. + uA1.w);
  if (abs(uA2.z) > 0.5) c = hueRot(c, uA2.z * 0.0174533);
  float vg = distance(vLocal, vec2(0.)) ;
  c *= 1. - uA2.w * smoothstep(.25, .75, vg);
  if (uA3.z > 0.) c += (hash(gl_FragCoord.xy + fract(uTime)*100.) - .5) * uA3.z * 0.35;
  c += uFlash;
  c *= uDim;
  c = clamp(c, 0., 1.);
  alpha = clamp(alpha, 0., 1.);
  outColor = vec4(c * alpha, alpha);
}`;

const VS_FULL = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p*2.-1., 0., 1.);
}`;

const FS_OVERLAY = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outColor; uniform sampler2D uTex; uniform float uAlpha;
void main(){ outColor = texture(uTex, vUV) * uAlpha; }`;

const FS_POST = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outColor;
uniform sampler2D uScene; uniform vec2 uRes; uniform float uTime;
uniform float uGlitch, uRgb, uVhs, uGrain, uFlash, uZoom, uBlur, uPixel, uMirror, uBw, uSepia, uVig, uGlow;
uniform vec2 uShake;
float hash(float n){ return fract(sin(n*91.345)*47453.5453); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUV;
  uv = (uv - 0.5) / uZoom + 0.5 + uShake;
  if (uMirror > 0.5 && uv.x > 0.5) uv.x = 1. - uv.x;
  if (uPixel > 0.01) { float px = mix(1., 60., uPixel); vec2 g = uRes / px; uv = (floor(uv*g)+0.5)/g; }
  float split = uRgb * 0.012;
  if (uGlitch > 0.01) {
    float tt = floor(uTime * 14.);
    float band = floor(uv.y * 24. + tt * 7.);
    float r = hash(band + tt);
    if (r > 1. - uGlitch * 0.45) { uv.x += (hash(band*3.1 + tt) - 0.5) * 0.18 * uGlitch; split += 0.012 * uGlitch; }
    float big = step(0.93, hash(tt*1.7)) * uGlitch;
    uv.x += big * (hash(floor(uv.y*6.)+tt) - 0.5) * 0.3;
  }
  if (uVhs > 0.01) {
    uv.x += sin(uv.y * 320. + uTime * 9.) * 0.0018 * uVhs;
    float wob = smoothstep(0.96, 1.0, sin(uv.y * 3. - uTime * 1.3) * 0.5 + 0.5);
    uv.x += wob * 0.02 * uVhs;
    split += 0.006 * uVhs;
  }
  vec3 c;
  if (uBlur > 0.01 || uGlow > 0.01) {
    float rad = uBlur * 0.03;
    vec3 acc = vec3(0.); float wsum = 0.;
    for (int i = 0; i < 24; i++) {
      float a = float(i) * 2.39996;
      float rr = sqrt((float(i)+0.5)/24.) * rad;
      vec2 o = vec2(cos(a), sin(a) * uRes.x/uRes.y) * rr;
      acc += texture(uScene, uv + o).rgb; wsum += 1.;
    }
    c = uBlur > 0.01 ? acc / wsum : texture(uScene, uv).rgb;
  } else if (split > 0.0001) {
    c = vec3(texture(uScene, uv + vec2(split, 0.)).r, texture(uScene, uv).g, texture(uScene, uv - vec2(split, 0.)).b);
  } else {
    c = texture(uScene, uv).rgb;
  }
  if (uGlow > 0.01) {
    vec3 g = vec3(0.);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996;
      float rr = sqrt((float(i)+0.5)/16.) * 0.035;
      vec2 o = vec2(cos(a), sin(a) * uRes.x/uRes.y) * rr;
      g += max(texture(uScene, uv + o).rgb - 0.55, 0.);
    }
    c += g / 16. * uGlow * 2.6;
  }
  float l = dot(c, vec3(.299,.587,.114));
  c = mix(c, vec3(l), uBw);
  vec3 sep = vec3(l*1.07, l*0.74, l*0.43);
  c = mix(c, sep, uSepia);
  if (uVhs > 0.01) {
    c *= 1. - uVhs * 0.18 * (0.5 + 0.5*sin(gl_FragCoord.y * 1.6));
    c += (hash2(uv*uRes + uTime) - .5) * 0.12 * uVhs;
    c = mix(c, vec3(dot(c, vec3(.3,.59,.11))), 0.15*uVhs);
  }
  if (uGrain > 0.01) c += (hash2(gl_FragCoord.xy + fract(uTime)*137.) - .5) * uGrain * 0.45;
  c *= 1. - uVig * smoothstep(0.3, 0.95, distance(vUV, vec2(.5)) * 1.45);
  c += uFlash;
  outColor = vec4(clamp(c, 0., 1.), 1.);
}`;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

function hexToRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const MASK_IDS = { none: 0, circle: 1, rounded: 2, ellipse: 3, fadeBottom: 4, fadeTop: 5, fadeSides: 6 };

// ---- Transformación animada de un clip visual en el instante lt ----
export function computeTransform(c, lt, W, H, srcW, srcH, xf, tAbs = 0) {
  const tf = c.tf;
  const fitS = tf.fit === 'contain' ? Math.min(W / srcW, H / srcH) : Math.max(W / srcW, H / srcH);
  let scale = tf.scale;
  let cx = W / 2 + tf.x * W;
  let cy = H / 2 + tf.y * H;
  let rot = (tf.rot * Math.PI) / 180;
  let alpha = tf.opacity;
  let lod = c.adj.blur * 6;
  let wipe = [1, 0, 1];
  let flash = 0;
  let dim = 1;
  const u = clamp(lt / c.dur, 0, 1);
  const a = c.motion.amount;
  switch (c.motion.type) {
    case 'zoomIn': scale *= 1 + 0.5 * a * u; break;
    case 'zoomOut': scale *= 1 + 0.5 * a * (1 - u); break;
    case 'panLeft': scale *= 1 + 0.25 * a; cx += (0.5 - u) * 0.25 * a * W; break;
    case 'panRight': scale *= 1 + 0.25 * a; cx -= (0.5 - u) * 0.25 * a * W; break;
    case 'panUp': scale *= 1 + 0.25 * a; cy += (0.5 - u) * 0.25 * a * H; break;
    case 'shake':
      scale *= 1 + 0.03 * a;
      cx += (Math.sin(lt * 61.3) + Math.sin(lt * 37.1 + 1.3)) * 0.008 * a * W;
      cy += (Math.sin(lt * 53.7 + 2.1) + Math.sin(lt * 29.9)) * 0.008 * a * H;
      rot += Math.sin(lt * 43) * 0.01 * a;
      break;
    case 'pulse': scale *= 1 + Math.pow(Math.abs(Math.sin(lt * Math.PI * 2)), 6) * 0.12 * a; break;
    case 'float': scale *= 1 + 0.04 * a; cy += Math.sin(lt * 2) * 0.02 * a * H; rot += Math.sin(lt) * 0.01 * a; break;
    case 'rotate': scale *= 1 + 0.4 * a; rot += lt * 0.2 * a; break;
    case 'bounce': { const s = Math.abs(Math.sin(lt * Math.PI * 2)); cy -= s * 0.03 * a * H; scale *= 1 + 0.04 * a * s; break; }
    case 'sway': scale *= 1 + 0.08 * a; rot += Math.sin(lt * 1.5) * 0.06 * a; break;
    default: break;
  }
  // transiciones
  const apply = (type, e, dirSign, isIn) => {
    const k = 1 - e; // 0 = plenamente visible
    if (k <= 0) return;
    switch (type) {
      case 'fade': alpha *= e; break;
      case 'slideL': cx += dirSign * k * W; break;
      case 'slideR': cx -= dirSign * k * W; break;
      case 'slideUp': cy += dirSign * k * H; break;
      case 'zoomIn': scale *= 1 + 0.6 * k * (isIn ? 1 : -0.5); alpha *= e; break;
      case 'zoomOut': scale *= 1 - 0.5 * k * (isIn ? 1 : -1); alpha *= e; break;
      case 'spin': rot += dirSign * k * Math.PI * 0.6; scale *= 0.6 + 0.4 * e; alpha *= e; break;
      case 'blur': lod += k * 6; alpha *= clamp(e * 1.5, 0, 1); break;
      case 'wipeL': wipe = isIn ? [-1, 0, e] : [1, 0, e]; break;
      case 'wipeUp': wipe = isIn ? [0, -1, e] : [0, 1, e]; break;
      case 'flash': flash += k * k * 1.2; alpha *= clamp(e * 3, 0, 1); break;
      case 'glitch': {
        const n = Math.floor(lt * 30);
        const r = Math.sin(n * 91.3) * 43758.5453; const rr = r - Math.floor(r);
        cx += (rr - 0.5) * 0.25 * W * k; if (rr > e + 0.35) alpha *= 0.2;
        break;
      }
      default: break;
    }
  };
  const ti = c.transIn;
  if (ti.type !== 'none' && lt < ti.dur && !(xf && xf.role === 'in')) apply(ti.type, easeOut(Math.max(0, lt) / ti.dur), 1, true);
  const to = c.transOut;
  const rem = c.dur - lt;
  if (to.type !== 'none' && rem < to.dur && !(xf && xf.role === 'out')) apply(to.type, easeOut(Math.max(0, rem) / to.dur), -1, false);
  // transición entre dos clips
  if (xf) {
    const p = clamp(xf.p, 0, 1), e = p * p * (3 - 2 * p), out = xf.role === 'out';
    switch (xf.type) {
      case 'fade': if (!out) alpha *= e; break;
      case 'black': alpha *= out ? clamp(1 - 2 * p, 0, 1) : clamp(2 * p - 1, 0, 1); break;
      case 'white': {
        const w = Math.sin(p * Math.PI);
        flash += w * 1.25;
        if (out) { if (p > 0.5) alpha = 0; } else if (p <= 0.5) alpha = 0;
        break;
      }
      case 'flash': if (!out) alpha *= clamp((p - 0.3) / 0.4, 0, 1); flash += Math.pow(Math.sin(p * Math.PI), 2) * 0.6; lod += Math.sin(p * Math.PI) * 1.5; break;
      case 'polvo': if (!out) alpha *= clamp((p - 0.03) / 0.42, 0, 1); break;
      case 'rafaga': {
        // la imagen que sale se aclara bajo la luz; la que entra aparece tras el blanco
        if (out) { flash += 0.2 * clamp(p / 0.2, 0, 1); alpha *= 1 - clamp((p - 0.14) / 0.16, 0, 1); }
        else { if (p < 0.62) alpha = 0; flash += 0.25 * clamp((0.95 - p) / 0.3, 0, 1); }
        break;
      }
      case 'blancoSuave': {
        // fundido lineal a blanco y de vuelta (mezcla, no suma: así el blanco es limpio)
        const k = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
        if (out) { if (p >= 0.5) alpha = 0; } else if (p < 0.5) alpha = 0;
        const kk = Math.min(0.999, k);
        dim = 1 - kk; flash += kk / (1 - kk);
        break;
      }
      case 'velo': {
        // velo de luz: la imagen se aclara como con bruma, se funde con la siguiente y la luz se retira despacio
        const lift = p < 0.38 ? Math.pow(p / 0.38, 1.5) : Math.pow(1 - (p - 0.38) / 0.62, 1.7);
        flash += 0.2 * lift;
        if (!out) alpha *= clamp((p - 0.3) / 0.35, 0, 1);
        break;
      }
      case 'zoomIn':
        if (out) { scale *= 1 + 1.4 * e; lod += e * 4; alpha *= 1 - clamp((p - 0.35) / 0.4, 0, 1); }
        else { scale *= 0.75 + 0.25 * e; lod += (1 - e) * 4; alpha *= clamp((p - 0.25) / 0.4, 0, 1); }
        break;
      case 'zoomOut':
        if (out) { scale *= 1 - 0.45 * e; lod += e * 3; alpha *= 1 - clamp((p - 0.35) / 0.4, 0, 1); }
        else { scale *= 1.6 - 0.6 * e; lod += (1 - e) * 4; alpha *= clamp((p - 0.25) / 0.4, 0, 1); }
        break;
      case 'slideL': cx += out ? -e * W : (1 - e) * W; break;
      case 'slideR': cx += out ? e * W : -(1 - e) * W; break;
      case 'slideUp': cy += out ? -e * H : (1 - e) * H; break;
      case 'slideDown': cy += out ? e * H : -(1 - e) * H; break;
      case 'spin':
        if (out) { rot += e * Math.PI; scale *= 1 - 0.7 * e; alpha *= 1 - clamp((p - 0.4) / 0.3, 0, 1); }
        else { rot -= (1 - e) * Math.PI; scale *= 0.3 + 0.7 * e; alpha *= clamp((p - 0.3) / 0.3, 0, 1); }
        break;
      case 'blur': if (out) { lod += e * 7; } else { lod += (1 - e) * 7; alpha *= e; } break;
      case 'wipeL': if (!out) wipe = [-1, 0, e]; break;
      case 'wipeUp': if (!out) wipe = [0, -1, e]; break;
      case 'glitch': {
        const n = Math.floor(tAbs * 24);
        const r = Math.sin(n * 91.3 + (out ? 0 : 17)) * 43758.5453, rr = r - Math.floor(r);
        const k = Math.sin(p * Math.PI);
        cx += (rr - 0.5) * 0.3 * W * k;
        cy += (Math.sin(n * 7.1) * 0.5) * 0.04 * H * k;
        if (out) { if (p > 0.5 && rr > 0.25) alpha = 0; } else if (p < 0.5 && rr < 0.75) alpha = 0;
        flash += k * (rr > 0.8 ? 0.6 : 0);
        break;
      }
      default: if (!out) alpha *= e;
    }
  }
  return {
    cx, cy, rot, alpha, lod, wipe, flash, dim,
    w: srcW * fitS * scale, h: srcH * fitS * scale, fitS, scale,
  };
}

export function effectiveAdj(c) {
  const f = FILTERS[c.filter] || FILTERS.none;
  const out = { ...ADJ_DEFAULT };
  for (const k in out) out[k] = (f.adj[k] || 0) * (c.filterAmt ?? 1) + (c.adj[k] || 0);
  return out;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.bounds = new Map();
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    this.W = canvas.width; this.H = canvas.height;
    this.locs = new Map();
    this.progLayer = this.program(VS_LAYER, FS_LAYER);
    this.progOverlay = this.program(VS_FULL, FS_OVERLAY);
    this.progPost = this.program(VS_FULL, FS_POST);
    this.vao = gl.createVertexArray();
    this.texCache = new Map(); // clave -> {tex, mip, has, w, h, ver}
    this.ovTex = [gl.createTexture(), gl.createTexture(), gl.createTexture()];
    this.ovTex.forEach((t) => this.setupTex(t));
    this.fbo = null; this.sceneTex = null;
    this.resize(canvas.width, canvas.height);
  }

  program(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  U(prog, name) {
    let m = this.locs.get(prog);
    if (!m) { m = {}; this.locs.set(prog, m); }
    if (!(name in m)) m[name] = this.gl.getUniformLocation(prog, name);
    return m[name];
  }

  setupTex(t) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(w, h) {
    const gl = this.gl;
    this.canvas.width = w; this.canvas.height = h;
    this.W = w; this.H = h;
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    this.sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.setupTex(this.sceneTex);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Textura de un clip (vídeo: una por clip; imagen: una por medio)
  getTexture(c, m, videoEl, needMip) {
    const gl = this.gl;
    const key = c.type === 'video' ? 'v' + c.id : 'i' + m.id;
    let e = this.texCache.get(key);
    if (!e) {
      e = { tex: gl.createTexture(), mip: false, has: false };
      this.setupTex(e.tex);
      this.texCache.set(key, e);
    }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    const upload = (src) => {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      e.has = true;
      e.dirtyMip = true;
    };
    if (c.type === 'video') {
      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth) upload(videoEl);
    } else if (!e.has && m.el && (m.el.complete !== false)) {
      upload(m.el);
    }
    if (!e.has) return null;
    if (needMip) {
      if (!e.mip) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); e.mip = true; e.dirtyMip = true; }
      if (e.dirtyMip) { gl.generateMipmap(gl.TEXTURE_2D); e.dirtyMip = false; }
    } else if (e.mip) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); e.mip = false;
    }
    return e;
  }

  // lee el color de un píxel del fotograma ya dibujado (x,y en 0..1 desde arriba-izquierda)
  readColor(x, y) {
    const gl = this.gl;
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(Math.floor(x * this.W), Math.floor((1 - y) * this.H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  releaseClip(id) {
    const e = this.texCache.get('v' + id);
    if (e) { this.gl.deleteTexture(e.tex); this.texCache.delete('v' + id); }
  }

  setBlend(mode) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    switch (mode) {
      case 'screen': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case 'add': gl.blendFunc(gl.ONE, gl.ONE); break;
      case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  drawLayer(c, lt, t, m, videoEl, xf) {
    c = animClip(c, Math.max(0, Math.min(c.dur, lt)));
    const gl = this.gl;
    const W = this.W, H = this.H;
    const sw = m.w || 1280, sh = m.h || 720;
    const T = computeTransform(c, lt, W, H, sw, sh, xf, t);
    {
      // zona que ocupa en pantalla (para tocar y para el recuadro de selección)
      const cr = c.crop, cw = 1 - cr.l - cr.r, chh = 1 - cr.t - cr.b;
      const ox = ((cr.l - cr.r) / 2) * T.w, oy = ((cr.t - cr.b) / 2) * T.h;
      const co = Math.cos(T.rot), si = Math.sin(T.rot);
      this.bounds.set(c.id, { cx: T.cx + ox * co - oy * si, cy: T.cy + ox * si + oy * co, w: T.w * cw, h: T.h * chh, rot: T.rot, a: T.alpha });
    }
    if (T.alpha <= 0.002) return;
    const needMip = T.lod > 0.05 || (c.tf.fit === 'contain' && c.tf.bgBlur);
    const e = this.getTexture(c, m, videoEl, needMip);
    if (!e) return;
    const P = this.progLayer;
    gl.useProgram(P);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.uniform1i(this.U(P, 'uTex'), 0);
    gl.uniform2f(this.U(P, 'uRes'), W, H);
    gl.uniform1f(this.U(P, 'uTime'), t);
    const adj = effectiveAdj(c);
    const crop = c.crop;
    const draw = (o) => {
      gl.uniform2f(this.U(P, 'uCenter'), o.cx, o.cy);
      gl.uniform2f(this.U(P, 'uSize'), o.w, o.h);
      gl.uniform1f(this.U(P, 'uRot'), o.rot);
      gl.uniform1f(this.U(P, 'uOpacity'), o.alpha);
      gl.uniform2f(this.U(P, 'uFlip'), c.tf.flipX ? -1 : 1, c.tf.flipY ? -1 : 1);
      gl.uniform4f(this.U(P, 'uCrop'), o.noCrop ? 0 : crop.l, o.noCrop ? 0 : crop.r, o.noCrop ? 0 : crop.t, o.noCrop ? 0 : crop.b);
      const mk = o.noMask ? 0 : MASK_IDS[c.mask.type] || 0;
      gl.uniform1i(this.U(P, 'uMask'), mk);
      gl.uniform1f(this.U(P, 'uMaskSize'), c.mask.size);
      gl.uniform1f(this.U(P, 'uMaskFeather'), c.mask.feather);
      const cw = (1 - crop.l - crop.r), ch = (1 - crop.t - crop.b);
      gl.uniform1f(this.U(P, 'uAspect'), (o.w * cw) / Math.max(1, o.h * ch));
      gl.uniform1f(this.U(P, 'uLod'), o.lod);
      gl.uniform3f(this.U(P, 'uWipe'), o.wipe[0], o.wipe[1], o.wipe[2]);
      gl.uniform1f(this.U(P, 'uFlash'), o.flash);
      gl.uniform1f(this.U(P, 'uDim'), o.dim ?? 1);
      const ck = c.chroma;
      gl.uniform1i(this.U(P, 'uKeyOn'), ck.on && !o.noKey ? 1 : 0);
      const kc = hexToRgb(ck.color);
      gl.uniform3f(this.U(P, 'uKey'), kc[0], kc[1], kc[2]);
      gl.uniform2f(this.U(P, 'uKeyP'), ck.sim * 0.6, ck.smooth * 0.6);
      const a = o.noAdj ? ADJ_DEFAULT : adj;
      gl.uniform4f(this.U(P, 'uA1'), a.exposure, a.brightness, a.contrast, a.saturation);
      gl.uniform4f(this.U(P, 'uA2'), a.temperature, a.tint, a.hue, a.vignette);
      gl.uniform4f(this.U(P, 'uA3'), a.highlights, a.shadows, a.grain, a.sharpen);
      this.setBlend(o.blend || 'normal');
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    // fondo desenfocado cuando se ajusta (contain)
    if (c.tf.fit === 'contain' && c.tf.bgBlur) {
      const cover = Math.max(W / sw, H / sh) * 1.15;
      draw({ cx: W / 2, cy: H / 2, w: sw * cover, h: sh * cover, rot: 0, alpha: T.alpha, lod: 5, wipe: T.wipe, flash: 0,
        dim: 0.65, noCrop: true, noMask: true, noKey: true, noAdj: true, blend: 'normal' });
    }
    draw({ ...T, blend: c.blend, lod: T.lod });
  }

  uploadOverlay(i, canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.ovTex[i]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  drawOverlay(i, additive) {
    const gl = this.gl;
    const P = this.progOverlay;
    gl.useProgram(P);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.ovTex[i]);
    gl.uniform1i(this.U(P, 'uTex'), 0);
    gl.uniform1f(this.U(P, 'uAlpha'), 1);
    gl.enable(gl.BLEND);
    if (additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ctx = { project, t, media, videoFor(clip), overlay }
  render(ctx) {
    const gl = this.gl;
    const { project, t, media, videoFor, overlay } = ctx;
    const W = this.W, H = this.H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    const bg = hexToRgb(project.bg || '#000000');
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.bounds = new Map();
    const xf = xfadeAt(project, t);
    const vis = project.clips.filter((c) => (c.type === 'video' || c.type === 'image') && ((t >= c.start - 1e-6 && t < c.start + c.dur) || xf.has(c.id)));
    const order = { video: 0, overlay: 1 };
    vis.sort((a, b) => order[a.lane] - order[b.lane] || (a.z || 0) - (b.z || 0) || a.start - b.start);
    for (const c of vis) {
      const m = media.get(c.media);
      if (!m) continue;
      this.drawLayer(c, t - c.start, t, m, c.type === 'video' ? videoFor(c) : null, xf.get(c.id));
    }
    // texto y partículas
    const ov = overlay.draw(project, t, W, H);
    if (ov.normal) { this.uploadOverlay(0, ov.normal); this.drawOverlay(0, false); }
    if (ov.add) { this.uploadOverlay(1, ov.add); this.drawOverlay(1, true); }
    if (ov.text) { this.uploadOverlay(2, ov.text); this.drawOverlay(2, false); }
    // post
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    const P = this.progPost;
    gl.useProgram(P);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.U(P, 'uScene'), 0);
    gl.uniform2f(this.U(P, 'uRes'), W, H);
    gl.uniform1f(this.U(P, 'uTime'), t);
    const p = ov.post;
    gl.uniform1f(this.U(P, 'uGlitch'), p.glitch);
    gl.uniform1f(this.U(P, 'uRgb'), p.rgb);
    gl.uniform1f(this.U(P, 'uVhs'), p.vhs);
    gl.uniform1f(this.U(P, 'uGrain'), p.grain);
    gl.uniform1f(this.U(P, 'uFlash'), p.flash);
    gl.uniform1f(this.U(P, 'uZoom'), p.zoom);
    gl.uniform1f(this.U(P, 'uBlur'), p.blur);
    gl.uniform1f(this.U(P, 'uPixel'), p.pixel);
    gl.uniform1f(this.U(P, 'uMirror'), p.mirror);
    gl.uniform1f(this.U(P, 'uBw'), p.bw);
    gl.uniform1f(this.U(P, 'uSepia'), p.sepia);
    gl.uniform1f(this.U(P, 'uVig'), p.vig);
    gl.uniform1f(this.U(P, 'uGlow'), p.glow);
    gl.uniform2f(this.U(P, 'uShake'), p.shake[0], p.shake[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

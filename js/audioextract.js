// Extrae la pista de audio AAC de un vídeo MP4/MOV (iPhone, iPad, cámaras…) sin cargar el vídeo entero
// y la convierte a ADTS (.aac), que Safari y Chrome saben decodificar siempre con decodeAudioData.

const rd = async (blob, off, len) => new DataView(await blob.slice(off, off + len).arrayBuffer());
const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

async function findTopBox(blob, type) {
  let off = 0;
  const size = blob.size;
  while (off + 8 <= size) {
    const hd = await rd(blob, off, 16);
    let sz = hd.getUint32(0);
    const t = fourcc(hd, 4);
    let hdr = 8;
    if (sz === 1) { sz = Number(hd.getBigUint64(8)); hdr = 16; } else if (sz === 0) sz = size - off;
    if (sz < 8) return null;
    if (t === type) return { off, size: sz, hdr };
    off += sz;
  }
  return null;
}

// recorre las cajas hijas dentro de [start, end) de un DataView
function children(dv, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let sz = dv.getUint32(o);
    const t = fourcc(dv, o + 4);
    let hdr = 8;
    if (sz === 1) { sz = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (sz === 0) sz = end - o;
    if (sz < 8 || o + sz > end) break;
    out.push({ t, o, sz, d: o + hdr, e: o + sz });
    o += sz;
  }
  return out;
}
const child = (dv, box, t) => children(dv, box.d, box.e).find((b) => b.t === t);
const path = (dv, box, ...ts) => { let b = box; for (const t of ts) { if (!b) return null; b = child(dv, b, t); } return b; };

function findEsds(dv, start, end) {
  for (const b of children(dv, start, end)) {
    if (b.t === 'esds') return b;
    if (b.t === 'wave') { const r = findEsds(dv, b.d, b.e); if (r) return r; }
  }
  return null;
}

function readDescLen(dv, o) {
  let len = 0, n = 0;
  for (; n < 4; n++) { const b = dv.getUint8(o + n); len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) { n++; break; } }
  return { len, n };
}

function parseAsc(dv, esds) {
  let o = esds.d + 4; // versión y flags
  const end = esds.e;
  while (o < end) {
    const tag = dv.getUint8(o);
    const { len, n } = readDescLen(dv, o + 1);
    const body = o + 1 + n;
    if (tag === 0x03) {
      let p = body + 2;
      const fl = dv.getUint8(p); p += 1;
      if (fl & 0x80) p += 2;
      if (fl & 0x40) p += 1 + dv.getUint8(p);
      if (fl & 0x20) p += 2;
      o = p; continue;
    }
    if (tag === 0x04) { o = body + 13; continue; }
    if (tag === 0x05) {
      const b0 = dv.getUint8(body), b1 = dv.getUint8(body + 1);
      let aot = b0 >> 3;
      let sfi = ((b0 & 7) << 1) | (b1 >> 7);
      let ch = (b1 >> 3) & 15;
      let freq = 0;
      if (sfi === 15) {
        const b2 = dv.getUint8(body + 2), b3 = dv.getUint8(body + 3), b4 = dv.getUint8(body + 4);
        freq = ((b1 & 0x7f) << 17) | (b2 << 9) | (b3 << 1) | (b4 >> 7);
        ch = (b4 >> 3) & 15;
      }
      return { aot, sfi, ch, freq };
    }
    o = body + len;
  }
  return null;
}

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export async function extractAacTrack(blob) {
  const moovBox = await findTopBox(blob, 'moov');
  if (!moovBox) return null;
  if (moovBox.size > 200 * 1024 * 1024) return null;
  const dv = await rd(blob, moovBox.off, moovBox.size);
  const moov = { d: moovBox.hdr, e: moovBox.size };
  for (const trak of children(dv, moov.d, moov.e).filter((b) => b.t === 'trak')) {
    const mdia = child(dv, trak, 'mdia');
    const hdlr = mdia && child(dv, mdia, 'hdlr');
    if (!hdlr || fourcc(dv, hdlr.d + 8) !== 'soun') continue;
    const mdhd = child(dv, mdia, 'mdhd');
    const ts = dv.getUint8(mdhd.d) === 1 ? dv.getUint32(mdhd.d + 20) : dv.getUint32(mdhd.d + 12);
    const stbl = path(dv, mdia, 'minf', 'stbl');
    if (!stbl) continue;
    const stsd = child(dv, stbl, 'stsd');
    const entry = children(dv, stsd.d + 8, stsd.e)[0];
    if (!entry || entry.t !== 'mp4a') return { unsupported: entry ? entry.t : '?' };
    const ver = dv.getUint16(entry.d + 8);
    let p = entry.d + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
    const esds = findEsds(dv, p, entry.e);
    if (!esds) return null;
    const asc = parseAsc(dv, esds);
    if (!asc) return null;
    // tabla de muestras
    const stsz = child(dv, stbl, 'stsz');
    const fixed = dv.getUint32(stsz.d + 4), count = dv.getUint32(stsz.d + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || dv.getUint32(stsz.d + 12 + i * 4);
    const stsc = child(dv, stbl, 'stsc');
    const nsc = dv.getUint32(stsc.d + 4);
    const sc = [];
    for (let i = 0; i < nsc; i++) sc.push([dv.getUint32(stsc.d + 8 + i * 12), dv.getUint32(stsc.d + 12 + i * 12)]);
    const stco = child(dv, stbl, 'stco'), co64 = child(dv, stbl, 'co64');
    const offs = [];
    if (stco) { const n = dv.getUint32(stco.d + 4); for (let i = 0; i < n; i++) offs.push(dv.getUint32(stco.d + 8 + i * 4)); }
    else if (co64) { const n = dv.getUint32(co64.d + 4); for (let i = 0; i < n; i++) offs.push(Number(dv.getBigUint64(co64.d + 8 + i * 8))); }
    else return null;
    // retardo inicial (edit list) para que el audio quede en su sitio exacto
    let skip = 0;
    const elst = path(dv, trak, 'edts', 'elst');
    if (elst) {
      const v = dv.getUint8(elst.d);
      const mt = v === 1 ? Number(dv.getBigInt64(elst.d + 16)) : dv.getInt32(elst.d + 12);
      if (mt > 0) skip = mt / ts;
    }
    // ADTS
    let sfi = asc.sfi;
    if (sfi === 15) { let best = 0; RATES.forEach((r, i) => { if (Math.abs(r - asc.freq) < Math.abs(RATES[best] - asc.freq)) best = i; }); sfi = best; }
    const ch = asc.ch || 2;
    const prof = (asc.aot === 5 || asc.aot === 29 || asc.aot > 4 ? 2 : asc.aot) - 1;
    let total = 0;
    for (let i = 0; i < count; i++) total += sizes[i] + 7;
    const out = new Uint8Array(total);
    let w = 0, si = 0;
    // lectura por bloques (cada «chunk» del archivo contiene varias muestras seguidas)
    const jobs = [];
    for (let ci = 0; ci < offs.length && si < count; ci++) {
      let k = sc.length - 1;
      while (k > 0 && sc[k][0] > ci + 1) k--;
      const n = Math.min(sc[k][1], count - si);
      let len = 0;
      for (let j = 0; j < n; j++) len += sizes[si + j];
      jobs.push({ off: offs[ci], len, first: si, n });
      si += n;
    }
    // agrupa bloques cercanos para leer menos veces
    const groups = [];
    for (const j of jobs) {
      const g = groups[groups.length - 1];
      if (g && j.off >= g.end && j.off - g.end < 256 * 1024 && j.off + j.len - g.start < 8 * 1024 * 1024) { g.items.push(j); g.end = j.off + j.len; }
      else groups.push({ start: j.off, end: j.off + j.len, items: [j] });
    }
    for (const g of groups) {
      const buf = new Uint8Array(await blob.slice(g.start, g.end).arrayBuffer());
      for (const j of g.items) {
        let o = j.off - g.start;
        for (let q = 0; q < j.n; q++) {
          const s = sizes[j.first + q];
          const fl = s + 7;
          out[w] = 0xff; out[w + 1] = 0xf1;
          out[w + 2] = ((prof & 3) << 6) | ((sfi & 15) << 2) | ((ch >> 2) & 1);
          out[w + 3] = ((ch & 3) << 6) | ((fl >> 11) & 3);
          out[w + 4] = (fl >> 3) & 0xff;
          out[w + 5] = ((fl & 7) << 5) | 0x1f;
          out[w + 6] = 0xfc;
          out.set(buf.subarray(o, o + s), w + 7);
          w += fl; o += s;
        }
      }
    }
    return { adts: out.buffer.slice(0, w), skip, rate: RATES[sfi], ch };
  }
  return { noAudio: true };
}

// Quita del principio el retardo del codificador
export function trimStart(ctx, buf, secs) {
  const n = Math.round(secs * buf.sampleRate);
  if (n <= 0 || n >= buf.length) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length - n, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(n));
  return out;
}

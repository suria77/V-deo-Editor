// Empaquetador MP4 mínimo (H.264 + AAC u Opus) para los fragmentos que produce WebCodecs.
const enc = new TextEncoder();

function u8(n) { return [n & 255]; }
function u16(n) { return [(n >> 8) & 255, n & 255]; }
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function i32(n) { return u32(n >>> 0); }
function str(s) { return [...enc.encode(s)]; }

function box(type, ...parts) {
  let len = 8;
  const flat = [];
  for (const p of parts) {
    if (p instanceof Uint8Array) { flat.push(p); len += p.length; } else { const a = Uint8Array.from(p.flat ? p.flat(Infinity) : p); flat.push(a); len += a.length; }
  }
  const out = new Uint8Array(len);
  out.set(u32(len), 0); out.set(str(type), 4);
  let o = 8;
  for (const a of flat) { out.set(a, o); o += a.length; }
  return out;
}
const full = (type, version, flags, ...parts) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

function desc(tag, bytes) {
  const b = [...bytes];
  return [tag, b.length, ...b];
}

export class Mp4Mux {
  constructor({ video, audio }) {
    this.v = video ? { ...video, timescale: 90000, samples: [], desc: null } : null;
    this.a = audio ? { ...audio, samples: [], desc: null } : null;
  }

  addVideo(chunk, meta) {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.v.desc) this.v.desc = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset, meta.decoderConfig.description.byteOffset + meta.decoderConfig.description.byteLength));
    this.v.samples.push({ data, pts: Math.round((chunk.timestamp * 90000) / 1e6), key: chunk.type === 'key' });
  }

  addAudio(chunk, meta) {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.a.desc) {
      const d = meta.decoderConfig.description;
      this.a.desc = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    }
    const dur = Math.round(((chunk.duration || 0) * this.a.sampleRate) / 1e6) || (this.a.codec === 'aac' ? 1024 : 960);
    this.a.samples.push({ data, dur, key: true });
  }

  // ---- tablas de muestras ----
  videoTables() {
    const s = this.v.samples;
    const fd = Math.round(90000 / this.v.fps);
    const sorted = s.map((x) => x.pts).sort((a, b) => a - b);
    let delay = 0;
    s.forEach((x, i) => { delay = Math.max(delay, sorted[i] - x.pts); });
    const dts = sorted.map((p) => p - delay);
    const durs = dts.map((d, i) => (i < dts.length - 1 ? dts[i + 1] - d : fd));
    const cts = s.map((x, i) => x.pts - dts[i]);
    return { durs, cts, delay, total: durs.reduce((a, b) => a + b, 0) };
  }

  stbl(tr, entry, durs, cts, offsets) {
    const sizes = tr.samples.map((x) => x.data.length);
    // stts (rle)
    const runs = [];
    for (const d of durs) { const l = runs[runs.length - 1]; if (l && l[1] === d) l[0]++; else runs.push([1, d]); }
    const parts = [
      full('stsd', 0, 0, u32(1), entry),
      full('stts', 0, 0, u32(runs.length), ...runs.map(([c, d]) => [...u32(c), ...u32(d)])),
    ];
    if (cts && cts.some((c) => c !== 0)) {
      const cr = [];
      for (const c of cts) { const l = cr[cr.length - 1]; if (l && l[1] === c) l[0]++; else cr.push([1, c]); }
      parts.push(full('ctts', 1, 0, u32(cr.length), ...cr.map(([n, c]) => [...u32(n), ...i32(c)])));
    }
    if (tr === this.v) {
      const keys = tr.samples.map((x, i) => (x.key ? i + 1 : 0)).filter(Boolean);
      parts.push(full('stss', 0, 0, u32(keys.length), ...keys.map((k) => u32(k))));
    }
    parts.push(full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)));
    parts.push(full('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map((z) => u32(z))));
    parts.push(full('stco', 0, 0, u32(offsets.length), ...offsets.map((o) => u32(o))));
    return box('stbl', ...parts);
  }

  trak(id, tr, kind, offsets) {
    const isV = kind === 'vide';
    let durs, cts = null, delay = 0, mediaDur, entry;
    if (isV) {
      const t = this.videoTables();
      durs = t.durs; cts = t.cts; delay = t.delay; mediaDur = t.total;
      const avcC = box('avcC', this.v.desc || new Uint8Array(0));
      entry = box('avc1', new Array(6).fill(0), u16(1), u16(0), u16(0), new Array(12).fill(0), u16(tr.width), u16(tr.height),
        u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff), avcC);
    } else {
      durs = tr.samples.map((x) => x.dur); mediaDur = durs.reduce((a, b) => a + b, 0);
      const head = [new Array(6).fill(0), u16(1), new Array(8).fill(0), u16(tr.channels), u16(16), u16(0), u16(0), u32(tr.sampleRate * 65536 >>> 0)];
      if (tr.codec === 'aac') {
        let asc = tr.desc;
        if (!asc || !asc.length) {
          const fi = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(tr.sampleRate);
          asc = Uint8Array.from([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (tr.channels << 3)]);
        }
        const dcd = desc(0x04, [0x40, 0x15, 0, 0, 0, ...u32(tr.bitrate || 192000), ...u32(tr.bitrate || 192000), ...desc(0x05, asc)]);
        const esd = desc(0x03, [...u16(0), 0, ...dcd, ...desc(0x06, [0x02])]);
        entry = box('mp4a', ...head, full('esds', 0, 0, esd));
      } else {
        let preskip = 312;
        if (tr.desc && tr.desc.length >= 12 && String.fromCharCode(...tr.desc.slice(0, 8)) === 'OpusHead') preskip = tr.desc[10] | (tr.desc[11] << 8);
        const dOps = box('dOps', u8(0), u8(tr.channels), u16(preskip), u32(tr.sampleRate), u16(0), u8(0));
        entry = box('Opus', ...head, dOps);
      }
    }
    const ts = isV ? 90000 : tr.sampleRate;
    const movieDur = Math.round(((mediaDur - delay) / ts) * 1000);
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDur), u32(0), u32(0), u16(0), u16(isV ? 0 : 0), u16(isV ? 0 : 0x0100), u16(0), MATRIX,
      u32(isV ? tr.width * 65536 : 0), u32(isV ? tr.height * 65536 : 0));
    const edts = delay ? box('edts', full('elst', 0, 0, u32(1), u32(movieDur), u32(delay), u32(0x10000))) : null;
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(mediaDur), u16(0x55c4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), str(kind), u32(0), u32(0), u32(0), str(isV ? 'VideoHandler' : 'SoundHandler'), [0]);
    const xmhd = isV ? full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)) : full('smhd', 0, 0, u16(0), u16(0));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const minf = box('minf', xmhd, dinf, this.stbl(tr, entry, durs, cts, offsets));
    const parts = [tkhd];
    if (edts) parts.push(edts);
    parts.push(box('mdia', mdhd, hdlr, minf));
    return { box: box('trak', ...parts), movieDur };
  }

  moov(offV, offA) {
    const traks = [];
    let dur = 0, id = 1;
    if (this.v && this.v.samples.length) { const t = this.trak(id++, this.v, 'vide', offV); traks.push(t.box); dur = Math.max(dur, t.movieDur); }
    if (this.a && this.a.samples.length) { const t = this.trak(id++, this.a, 'soun', offA); traks.push(t.box); dur = Math.max(dur, t.movieDur); }
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(dur), u32(0x10000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Array(24).fill(0), u32(id));
    return box('moov', mvhd, ...traks);
  }

  finalize() {
    const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    const vs = this.v ? this.v.samples : [], as = this.a ? this.a.samples : [];
    const zeroV = vs.map(() => 0), zeroA = as.map(() => 0);
    const moovSize = this.moov(zeroV, zeroA).length;
    let o = ftyp.length + moovSize + 8;
    const offV = vs.map((s) => { const r = o; o += s.data.length; return r; });
    const offA = as.map((s) => { const r = o; o += s.data.length; return r; });
    const moov = this.moov(offV, offA);
    const mdatLen = 8 + vs.reduce((a, s) => a + s.data.length, 0) + as.reduce((a, s) => a + s.data.length, 0);
    const mdatHead = new Uint8Array(8);
    mdatHead.set(u32(mdatLen), 0); mdatHead.set(str('mdat'), 4);
    return new Blob([ftyp, moov, mdatHead, ...vs.map((s) => s.data), ...as.map((s) => s.data)], { type: 'video/mp4' });
  }
}

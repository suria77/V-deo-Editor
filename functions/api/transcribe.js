// Cloudflare Pages Function: reenvía el audio a ElevenLabs Speech-to-Text (Scribe) con marcas de tiempo por palabra.
// La clave llega en la cabecera x-el-key (guardada en el dispositivo) o, si la configuras, en la variable ELEVENLABS_API_KEY.
export async function onRequestPost({ request, env }) {
  const key = request.headers.get('x-el-key') || env.ELEVENLABS_API_KEY;
  if (!key) return new Response(JSON.stringify({ detail: { message: 'Falta la clave de ElevenLabs' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  const lang = new URL(request.url).searchParams.get('lang') || '';
  const audio = await request.arrayBuffer();
  const send = (model) => {
    const fd = new FormData();
    fd.append('model_id', model);
    fd.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
    fd.append('timestamps_granularity', 'word');
    fd.append('tag_audio_events', 'false');
    if (lang) fd.append('language_code', lang);
    return fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  };
  let r = await send('scribe_v2');
  if (!r.ok && r.status !== 401) {
    const t = await r.text();
    if (/model/i.test(t)) r = await send('scribe_v1');
    else return new Response(t, { status: r.status, headers: { 'content-type': 'application/json' } });
  }
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

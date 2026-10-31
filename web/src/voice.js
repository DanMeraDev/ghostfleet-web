// Voice, both ways. Local first (whisper.cpp to hear, Kokoro to speak, on the machine running
// the server), the browser's own as the fallback. The rest of the app only sees listen()/speak().
import { api } from './api.js';

let status = null;
export async function voiceStatus(force = false) {
  if (status && !force) return status;
  try { status = await api.voice(); } catch { status = { hear: { ready: false }, speak: { ready: false } }; }
  return status;
}

// ── hearing, locally: record until the speaker stops, ship a 16 kHz mono WAV ─────────────
function wav16k(chunks, rate) {
  let n = 0; for (const c of chunks) n += c.length;
  const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = rate / 16000, len = Math.floor(all.length / ratio);
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    // average the source samples this output sample covers: a cheap low-pass before decimating
    const a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = a; j < b; j++) sum += all[j];
    const s = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Returns a handle {stop, cancel}. Callbacks: onLevel(0..1), onState('listening'|'hearing'),
// onText(text) with the transcript, onError(msg).
export function listenLocal({ onLevel, onState, onText, onError, silenceMs = 1200, maxMs = 30000 }) {
  let stream, ctx, node, src, done = false, spoke = false, quietSince = 0;
  const chunks = [];
  const t0 = performance.now();
  const finish = async (send) => {
    if (done) return; done = true;
    try { node?.disconnect(); src?.disconnect(); } catch {}
    try { stream?.getTracks().forEach(t => t.stop()); } catch {}
    const rate = ctx?.sampleRate || 48000;
    try { await ctx?.close(); } catch {}
    if (!send || !spoke || !chunks.length) { onText?.(''); return; }
    onState?.('hearing');
    try {
      const res = await fetch('/api/hear', { method: 'POST', headers: { 'X-GFW': '1', 'Content-Type': 'audio/wav' }, body: wav16k(chunks, rate) });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.text || `error ${res.status}`);
      onText?.(String(j.text || '').trim());
    } catch (e) { onError?.(`No se pudo transcribir: ${e.message}`); onText?.(''); }
  };
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) { done = true; onError?.('El navegador no dio permiso al micrófono. Actívalo en el candado de la barra de direcciones.'); onText?.(''); return; }
    ctx = new AudioContext();
    src = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(4096, 1, 1);
    let floor = 0.01;
    node.onaudioprocess = (e) => {
      if (done) return;
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length);
      const now = performance.now();
      if (now - t0 < 400) floor = Math.max(floor, rms * 1.5);        // learn the room's noise first
      const loud = rms > Math.max(0.015, floor * 2);
      onLevel?.(Math.min(1, rms * 12));
      if (loud) { spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = now;
      if (spoke && quietSince && now - quietSince > silenceMs) finish(true);
      else if (now - t0 > maxMs) finish(true);
      else if (!spoke && now - t0 > 8000) finish(false);             // nobody said anything
    };
    src.connect(node); node.connect(ctx.destination);
    onState?.('listening');
  })();
  return { stop: () => finish(true), cancel: () => finish(false) };
}

// ── hearing, in the browser: Chrome/Edge/Safari's recogniser ────────────────────────────
const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const browserCanHear = !!Recognition;
export function listenBrowser({ onInterim, onState, onText, onError, lang = 'es-ES' }) {
  const r = new Recognition();
  r.lang = lang; r.interimResults = true; r.continuous = false;
  let final = '';
  r.onresult = (e) => {
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript; else live += e.results[i][0].transcript;
    }
    onInterim?.((final + ' ' + live).trim());
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed') onError?.('El navegador no dio permiso al micrófono.');
    else if (e.error === 'network') onError?.('El dictado del navegador necesita internet.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.(`Dictado: ${e.error}`);
  };
  r.onend = () => onText?.(final.trim());
  try { r.start(); onState?.('listening'); } catch { onText?.(''); }
  return { stop: () => { try { r.stop(); } catch {} }, cancel: () => { try { r.abort(); } catch {} } };
}

// ── speaking ─────────────────────────────────────────────────────────────────────────────
export const plainText = (md) => String(md || '')
  .replace(/```[\s\S]*?```/g, ' (código) ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/[*_#>|]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

let playing = null;
export function stopSpeaking() {
  window.speechSynthesis?.cancel();
  if (playing) { playing.cancelled = true; try { playing.audio?.pause(); } catch {} playing = null; }
}
function speakBrowser(text, onEnd) {
  const s = window.speechSynthesis;
  if (!s) { onEnd?.(); return; }
  const u = new SpeechSynthesisUtterance(text.slice(0, 900));
  const v = s.getVoices().find(v => /^es(-|_)(419|MX|US|EC|CO|AR)/i.test(v.lang)) || s.getVoices().find(v => /^es/i.test(v.lang));
  if (v) u.voice = v;
  u.lang = v?.lang || 'es-ES'; u.rate = 1.05;
  u.onend = () => onEnd?.(); u.onerror = () => onEnd?.();
  s.speak(u);
}
export async function speak(md, onEnd) {
  stopSpeaking();
  const text = plainText(md).slice(0, 1500);
  if (!text) { onEnd?.(); return; }
  const st = await voiceStatus();
  if (!st.speak?.ready) { speakBrowser(text, onEnd); return; }
  const job = { cancelled: false, audio: null };
  playing = job;
  try {
    const r = await api.speak(text);
    if (job.cancelled) return;
    for (const s of r.sentences) {
      if (job.cancelled) return;
      await new Promise((resolve) => {
        const a = new Audio(`/api/speak/${s.id}`);
        job.audio = a;
        a.onended = resolve; a.onerror = resolve;
        a.play().catch(resolve);
      });
    }
  } catch { if (!job.cancelled) speakBrowser(text, onEnd); return; }
  if (!job.cancelled) { playing = null; onEnd?.(); }
}

// server/voice.mjs — hearing and speaking on THIS machine, through ghostfleet's own code:
// lib/jarvis.mjs runs whisper.cpp, lib/speech.mjs runs Kokoro. Both are optional and found
// rather than configured; when either is missing the browser falls back to its own voice.
// Nothing spoken is kept: whisper's input lives in a temp dir that is removed before the
// transcript returns, and the log line carries sizes and times, never words.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GF_HOME } from './paths.mjs';

const load = async (rel) => {
  const p = path.join(GF_HOME, rel);
  if (!fs.existsSync(p)) return null;
  try { return await import(pathToFileURL(p).href); } catch { return null; }
};
const jarvis = await load('lib/jarvis.mjs');
const speech = await load('lib/speech.mjs');

export function status() {
  const hear = jarvis ? jarvis.voiceStatus() : { ready: false, why: `ghostfleet no está instalado en ${GF_HOME}` };
  const speak = speech ? speech.status() : { ready: false, why: `ghostfleet no está instalado en ${GF_HOME}` };
  return { hear: { ready: !!hear.ready, why: hear.ready ? null : hear.why },
           speak: { ready: !!speak.ready, why: speak.ready ? null : speak.why } };
}

// One transcription at a time: whisper takes every core it is given.
let chain = Promise.resolve();
export function hear(wav, words = []) {
  if (!jarvis) return Promise.resolve({ error: 'ghostfleet no está instalado' });
  if (!jarvis.isWav(wav)) return Promise.resolve({ error: 'eso no es un WAV' });
  // The names on screen are the words whisper is likeliest to mishear, so they go in the prompt.
  const prompt = `Proyectos y sesiones: ${words.slice(0, 40).join(', ')}.`;
  const run = () => jarvis.transcribeAsync(wav, { prompt, lang: process.env.GFW_VOICE_LANG || 'es', timeout: 90000 });
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const speakLog = (m) => console.log(new Date().toISOString().slice(11, 19), 'speak:', m);
export function plan(text, more = false) {
  if (!speech) return { error: 'ghostfleet no está instalado' };
  const items = speech.plan(String(text || '').slice(0, 8000));
  if (!items.length) return { error: 'no hay nada que leer' };
  speech.prefetch(items, speakLog, { append: more });
  return { sentences: items.map(({ id, lang, voice, text: t }) => ({ id, lang, voice, text: t })) };
}
export async function audio(id) {
  if (!speech || !speech.validId(id)) return { status: 400, error: 'id de frase inválido' };
  const pending = speech.audio(id, speakLog);
  if (!pending) return { status: 404, error: 'frase desconocida' };
  let r;
  try { r = await pending; } catch (e) { return { status: 503, error: String(e?.message || e) }; }
  try { return { wav: fs.readFileSync(r.path) }; } catch { return { status: 410, error: 'ese audio ya se borró' }; }
}

/**
 * Lectures over the network: transcribing pieces of a recording, and asking
 * the AI for notes. The pure parts live in lectureNotes.js.
 */
import { AI_ENDPOINT, db } from '@/api/db';
import { toBase64 } from './recorder.js';
import { transcribeLocally } from './desktop.js';
import { sections, sectionPrompt, notesPrompt, normaliseNotes, NOTES_SCHEMA } from './lectureNotes.js';

export * from './lectureNotes.js';

/** The AI being briefly overloaded is worth waiting out; a bad request isn't. */
async function ask(request, tries = 4) {
  let wait = 3000;
  for (let i = 0; ; i++) {
    try {
      return await db.integrations.Core.InvokeLLM(request);
    } catch (e) {
      const busy = /demand|busy|overload|try again|temporar|unavailable|\b50[234]\b|429/i.test(e?.message || '');
      if (!busy || i >= tries - 1) throw e;
      await new Promise(r => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

/**
 * Send one piece of recording to the AI proxy for its words. `hint` is the
 * class name and the end of what was said just before, which helps names
 * and terms come out spelled right. Retries a busy proxy a few times.
 */
export async function transcribeChunk(wav, hint = '', { tries = 4 } = {}) {
  // In the desktop app, on this computer first: private, free, no service limits.
  try {
    const local = await transcribeLocally(wav, hint);
    if (local !== null) return local.trim();
  } catch (_) { /* the engine hiccuped: the online service takes this piece */ }
  const body = JSON.stringify({ mode: 'transcribe', audio: toBase64(wav), mimeType: 'audio/wav', hint });
  let wait = 2000;
  for (let i = 0; ; i++) {
    let r, j = null;
    try {
      r = await fetch(AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      try { j = await r.json(); } catch (_) {}
    } catch (_) {
      r = null;
    }
    if (j?.ok) return (j.text || '').trim();
    const retry = !r || r.status === 429 || r.status >= 500;
    if (!retry || i >= tries - 1) {
      throw Object.assign(new Error(j?.error || (r ? `Transcription failed (${r.status}).` : 'No connection to transcribe that part.')),
        { status: r?.status || 0 });
    }
    await new Promise(res => setTimeout(res, wait));
    wait *= 2;
  }
}

/**
 * Transcript (+ the student's own notes) -> notes. Short lectures go in one
 * request; long ones are condensed section by section first, then combined.
 * `onProgress(text)` reports what it's doing.
 */
export async function generateNotes({ transcript, myNotes, className, title, date, how }, onProgress) {
  if (!transcript.trim()) throw new Error('There is no transcript yet to make notes from.');
  let material = transcript;
  const parts = sections(transcript);
  if (parts.length > 1) {
    const condensed = [];
    for (let i = 0; i < parts.length; i++) {
      onProgress?.(`Reading part ${i + 1} of ${parts.length}…`);
      condensed.push(await ask({ prompt: sectionPrompt(parts[i], i, parts.length, className) }));
    }
    material = condensed.map((c, i) => `[Part ${i + 1}]\n${c}`).join('\n\n');
  }
  onProgress?.('Writing your notes…');
  const raw = await ask({
    prompt: notesPrompt({ transcript: material.slice(0, 22000), myNotes, className, title, date, how }),
    response_json_schema: NOTES_SCHEMA,
  });
  return normaliseNotes(raw);
}

/**
 * The parts of the voice that are just text and arithmetic, kept apart from
 * voice.js so they can be tested in Node (tests/speakable.test.mjs).
 */

/** Turn markdown and chat formatting into something that reads aloud well. */
export function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' a link ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+•]\s+/gm, '')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.(\s*\.)+/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Sentence-sized pieces, each under `max` characters. */
export function chunks(text, max = 220) {
  const sentences = String(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [String(text)];
  const out = [];
  let cur = '';
  for (let s of sentences.map(x => x.trim()).filter(Boolean)) {
    while (s.length > max) {                  // one very long sentence: break at a comma or space
      let cut = s.lastIndexOf(', ', max);
      if (cut < max / 2) cut = s.lastIndexOf(' ', max);
      if (cut < 1) cut = max;
      if (cur) { out.push(cur); cur = ''; }
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if ((cur + ' ' + s).trim().length > max) { if (cur) out.push(cur); cur = s; }
    else cur = (cur + ' ' + s).trim();
  }
  if (cur) out.push(cur);
  return out;
}

export const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|espeak|robot/i;

export function voiceScore(v, lang = 'en-US') {
  const n = (v.name || '').toLowerCase();
  let s = 0;
  if (/natural|neural/.test(n)) s += 8;          // Edge: "Microsoft Aria Online (Natural)"
  if (/premium|enhanced|siri/.test(n)) s += 6;   // Apple's downloadable voices
  if (/^google /.test(n)) s += 4;                // Chrome's network voices
  if (/online/.test(n)) s += 2;
  if (v.localService === false) s += 1;
  if (NOVELTY.test(n)) s -= 30;
  const vl = (v.lang || '').toLowerCase().replace('_', '-');
  const want = lang.toLowerCase();
  if (vl === want) s += 3;
  else if (vl.split('-')[0] === want.split('-')[0]) s += 2;
  else s -= 15;
  return s;
}


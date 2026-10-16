/**
 * Companion's conversation history: what a saved conversation looks like, and how it
 * turns back into messages. Pure, so it is tested in Node (tests/companionHistory.test.mjs).
 *
 * Each conversation is one record in StudyHistory with type "companion". The server
 * already keeps StudyHistory per account (so it follows the student to every device),
 * and the Practice page filters these records out of its own list.
 */

export const HISTORY_TYPE = 'companion';
const MAX_MESSAGES = 60;        // the newest turns are kept
const MAX_TEXT = 1500;          // characters per message; longer replies are cut short
const MAX_TITLE = 64;

const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** The conversation's name: what the student first asked. */
export function titleOf(messages) {
  const first = (messages || []).find(m => m.role === 'user' && String(m.text || '').trim());
  return cut(first?.text || 'Conversation', MAX_TITLE) || 'Conversation';
}

/** A short line of the latest reply, for the list. */
export function previewOf(messages) {
  const last = [...(messages || [])].reverse().find(m => m.role === 'assistant' && String(m.text || '').trim());
  return cut(last?.text || '', 120);
}

/** The messages, trimmed to what is worth keeping (text only; no attachments or photos). */
export function compact(messages) {
  return (messages || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && String(m.text || '').trim())
    .slice(-MAX_MESSAGES)
    .map(m => ({ id: String(m.id || ''), role: m.role, text: String(m.text).slice(0, MAX_TEXT), at: Number(m.at) || Date.now() }));
}

/** The data to save for a conversation. */
export function toRecord(messages) {
  const kept = compact(messages);
  return {
    type: HISTORY_TYPE,
    title: titleOf(kept),
    preview: previewOf(kept),
    messages: kept,
    turns: kept.filter(m => m.role === 'user').length,
  };
}

/** A saved record back into the messages the panel shows. */
export function fromRecord(rec) {
  return (rec?.messages || []).map(m => ({ id: m.id || `h${m.at}${Math.random().toString(36).slice(2, 6)}`, role: m.role, text: m.text, at: m.at }));
}

/** Newest first, and only Companion's own records. */
export function listOf(records) {
  return (records || [])
    .filter(r => r && r.type === HISTORY_TYPE)
    .sort((a, b) => String(b.updated_date || b.created_date || '').localeCompare(String(a.updated_date || a.created_date || '')));
}

/**
 * Lecture notes out of LOCK IN!, into the apps students already use:
 *
 *   Copy        formatted, so pasting into Google Docs, OneNote, Notion or Word keeps
 *               the headings and lists
 *   .doc        an HTML document Word and Google Docs both open as a document
 *   .md         Markdown, which Notion, Obsidian and most note apps import
 *
 * One lecture, or every lecture in a class as one document. The text and Markdown
 * are pure (tests/noteExport.test.mjs); copying and downloading need a browser.
 */
import { notesMarkdown, normaliseNotes } from './lectureNotes.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const metaOf = (l) => ({ title: l.title || l.notes?.title || 'Lecture notes', className: l.class_name || '', date: l.date || '' });

/** One lecture as Markdown: the notes, then the student's own notes if there are any. */
export function lectureMarkdown(l) {
  const meta = metaOf(l);
  const parts = [];
  if (l.notes) parts.push(notesMarkdown(l.notes, meta));
  else parts.push(`# ${meta.title}`, [meta.className, meta.date].filter(Boolean).join(' · ') ? `_${[meta.className, meta.date].filter(Boolean).join(' · ')}_` : '');
  const mine = String(l.my_notes || '').trim();
  if (mine) parts.push('', '## My notes', '', mine);
  return parts.filter((x, i) => x !== '' || i > 0).join('\n').trim() + '\n';
}

/** One lecture as HTML (a fragment: headings, paragraphs and lists). */
export function lectureHtml(l) {
  const meta = metaOf(l);
  const n = l.notes ? normaliseNotes(l.notes) : null;
  const h = [`<h1>${esc(n?.title || meta.title)}</h1>`];
  const sub = [meta.className, meta.date].filter(Boolean).join(' · ');
  if (sub) h.push(`<p><em>${esc(sub)}</em></p>`);
  if (n) {
    if (n.summary) h.push(`<p>${esc(n.summary)}</p>`);
    for (const s of n.sections) {
      h.push(`<h2>${esc(s.heading || 'Notes')}</h2>`);
      if (s.points.length) h.push(`<ul>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`);
    }
    if (n.key_terms.length) h.push('<h2>Key terms</h2>', `<ul>${n.key_terms.map(k => `<li><strong>${esc(k.term)}</strong>: ${esc(k.definition)}</li>`).join('')}</ul>`);
    if (n.action_items.length) h.push('<h2>To do</h2>', `<ul>${n.action_items.map(a => `<li>${esc(a.title)}${a.due ? ` (${esc(a.due)})` : ''}</li>`).join('')}</ul>`);
    if (n.review_questions.length) h.push('<h2>Check yourself</h2>', `<ol>${n.review_questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol>`);
  }
  const mine = String(l.my_notes || '').trim();
  if (mine) h.push('<h2>My notes</h2>', ...mine.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`));
  return h.join('\n');
}

/** Several lectures (a class) as one: oldest first, each starting a new page in Word. */
export function bundle(lectures, title) {
  const list = [...lectures].sort((a, b) => String(a.date || a.started_at || '').localeCompare(String(b.date || b.started_at || '')));
  return {
    md: `# ${title}\n\n` + list.map(lectureMarkdown).join('\n---\n\n'),
    html: `<h1>${esc(title)}</h1>\n` + list.map(l => `<div style="page-break-before:always">${lectureHtml(l).replace(/<(\/?)h2>/g, '<$1h3>').replace(/<(\/?)h1>/g, '<$1h2>')}</div>`).join('\n'),
  };
}

/** A whole document Word (and Google Docs, when uploaded) opens as a document. */
export function wordDocument(fragment, title) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4} h1{font-size:20pt} h2{font-size:14pt;margin-top:14pt} li{margin:2pt 0}</style>
</head><body>
${fragment}
</body></html>`;
}

/** A file name from a title: letters, numbers and dashes. */
export const fileName = (title, ext) => `${String(title || 'notes').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'notes'}.${ext}`;

export function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Formatted when the browser allows it (keeps headings when pasted), plain Markdown otherwise. */
export async function copyFormatted(html, md) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([md], { type: 'text/plain' }),
      })]);
      return 'formatted';
    } catch (_) { /* fall through to plain text */ }
  }
  await navigator.clipboard.writeText(md);
  return 'plain';
}

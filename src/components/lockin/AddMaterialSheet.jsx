import React, { useState } from 'react';
import { FilePlus, Loader2 } from 'lucide-react';
import Sheet from '@/components/lockin/Sheet';
import { useLecture } from '@/lib/LectureContext';
import { toast } from '@/components/ui/use-toast';

/**
 * Add a handout, a study guide, a photo of the board or pasted notes to a
 * class. It's read once into text and kept with the class, so it can be asked
 * about and quizzed on like a lecture. Opened from the class's card.
 */
export default function AddMaterialSheet({ classes, defaultClass = '', onClose, onAdded }) {
  const lec = useLecture();
  const [cls, setCls] = useState(defaultClass || classes[0]?.name || '');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const add = async () => {
    setError('');
    setBusy('Starting…');
    try {
      const c = classes.find(x => x.name === cls);
      const l = await lec.addMaterial({ title, className: cls, classId: c?.id || '', text, files }, setBusy);
      toast({ title: 'Added', description: `${l.title} is with ${cls || 'your notes'}` });
      onAdded?.(l);
    } catch (e) {
      setError(e.message || 'That couldn’t be added.');
    } finally {
      setBusy('');
    }
  };
  return (
    <Sheet title="Add material" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3 px-3 pb-2">
        <label className="block text-sm font-medium text-foreground">
          Class
          <select value={cls} onChange={e => setCls(e.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-card px-3 text-base text-foreground sm:text-sm">
            <option value="">No class</option>
            {classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-foreground">
          Name
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Unit 3 study guide"
            className="mt-1 h-11 w-full rounded-xl border bg-card px-3 text-base text-foreground" />
        </label>
        <label className="block text-sm font-medium text-foreground">
          Files
          <input type="file" multiple accept="application/pdf,image/*,.txt,.md,text/plain" onChange={e => setFiles(Array.from(e.target.files || []))}
            className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:h-10 file:rounded-lg file:border file:bg-card file:px-3 file:text-foreground" />
        </label>
        <label className="block text-sm font-medium text-foreground">
          Or paste text
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
            className="mt-1 w-full rounded-xl border bg-card p-3 text-base text-foreground outline-none focus:border-primary/60" />
        </label>
        {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        <button type="button" onClick={add} disabled={!!busy || (!files.length && text.trim().length < 20)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" />{busy}</> : <><FilePlus className="h-4 w-4" />Add</>}
        </button>
        <p className="text-xs text-muted-foreground">PDFs, photos or text, up to 4 MB each.</p>
      </div>
    </Sheet>
  );
}

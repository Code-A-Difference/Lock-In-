import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, User, Clock, Share2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sharing } from '@/api/db';

/**
 * A class, and the code to share it. The code is built fresh each time the
 * dialog opens, so it always carries the homework and tests as they are now.
 */
export default function ClassDetailsDialog({ open, onOpenChange, classItem }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !classItem) return;
    let live = true;
    setCode(''); setError(''); setCopied(false);
    sharing.encodeClass(classItem.id)
      .then(c => { if (live) setCode(c); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, classItem]);

  if (!classItem) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      setError('Copy was blocked — select the code and copy it by hand.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{classItem.name}</DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {classItem.teacher && (
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <User className="h-4 w-4" /><span>{classItem.teacher}</span>
            </div>
          )}
          {classItem.schedule && (
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Clock className="h-4 w-4" /><span>{classItem.schedule}</span>
            </div>
          )}

          <div className="border-t pt-4 dark:border-slate-700">
            <p className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              <Share2 className="h-4 w-4 text-indigo-500" /> Share this class
            </p>
            <p className="mb-3 text-xs text-slate-500">
              Send this code to a classmate. They paste it into <em>Add a shared class</em> and get
              this class with its homework and tests. Added more since? Send a fresh code — pasting
              it again only adds what's new.
            </p>

            <div className="relative">
              <div className="max-h-28 min-h-[4.5rem] overflow-y-auto break-all rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {code || (!error && <span className="flex items-center gap-2 text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Making the code…</span>)}
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

            <Button onClick={copy} disabled={!code}
                    className={cn('mt-3 w-full', copied ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-indigo-600 hover:bg-indigo-500')}>
              {copied ? <><Check className="mr-2 h-4 w-4" />Copied</> : <><Copy className="mr-2 h-4 w-4" />Copy share code</>}
            </Button>
            {code && <p className="mt-2 text-center text-[11px] text-slate-400">{code.length.toLocaleString()} characters</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

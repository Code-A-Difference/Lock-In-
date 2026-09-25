import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Share2, ClipboardPaste } from "lucide-react";

/**
 * Add a class a classmate shared. The code is long because it carries the
 * class and its homework and tests inside it, so nobody's account has to be
 * opened to anyone else to share one.
 */
export default function JoinClassDialog({ open, onOpenChange, onSubmit, isLoading }) {
  const [code, setCode] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    onSubmit(code.trim());
  };

  const paste = async () => {
    try { setCode(await navigator.clipboard.readText()); } catch (_) { /* browser said no; they can paste by hand */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setCode(''); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <Share2 className="h-5 w-5 text-indigo-500" />
            Add a shared class
          </DialogTitle>
          <DialogDescription>
            Paste the share code a classmate sent you. You'll get your own copy of the class
            with its homework and tests.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="share_code">Share code</Label>
              <button type="button" onClick={paste} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">
                <ClipboardPaste className="h-3.5 w-3.5" /> Paste
              </button>
            </div>
            <Textarea
              id="share_code"
              placeholder="LOCKIN1.…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={4}
              spellCheck={false}
              className="break-all font-mono text-xs"
              required
            />
            <p className="text-xs text-slate-500">
              Already have this class? Adding it again only brings in homework and tests you don't have yet.
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading || !code.trim()}>
            {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</> : 'Add class'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

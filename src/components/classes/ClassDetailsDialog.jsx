import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Users, User, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ClassDetailsDialog({ open, onOpenChange, classItem }) {
  const [copied, setCopied] = useState(false);

  if (!classItem) return null;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(classItem.join_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{classItem.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          {classItem.teacher && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <User className="w-4 h-4" />
              <span>{classItem.teacher}</span>
            </div>
          )}
          
          {classItem.schedule && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock className="w-4 h-4" />
              <span>{classItem.schedule}</span>
            </div>
          )}
          
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Users className="w-4 h-4" />
            <span>{classItem.members?.length || 0} {classItem.members?.length === 1 ? 'member' : 'members'}</span>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium text-slate-700 mb-2">Share this code to invite classmates:</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-slate-50 border-2 border-dashed border-slate-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-mono font-bold text-slate-800 tracking-widest">
                  {classItem.join_code}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyCode}
                className={cn(
                  "h-14 w-14 transition-colors",
                  copied && "bg-green-50 border-green-200"
                )}
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Anyone with this code can join and contribute to this class
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
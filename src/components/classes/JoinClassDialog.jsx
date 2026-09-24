import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Users } from "lucide-react";

export default function JoinClassDialog({ open, onOpenChange, onSubmit, isLoading }) {
  const [joinCode, setJoinCode] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(joinCode.trim().toUpperCase());
    setJoinCode('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-500" />
            Join a Class
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="join_code">Class Code</Label>
            <Input
              id="join_code"
              placeholder="Enter 6-digit code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="text-lg tracking-widest text-center font-mono"
              required
            />
            <p className="text-xs text-slate-500">
              Ask your classmate for the class code to join
            </p>
          </div>
          
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Joining...
              </>
            ) : (
              'Join Class'
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
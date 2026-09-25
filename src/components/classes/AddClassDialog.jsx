import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

const CLASS_COLORS = [
  { name: 'Indigo', value: 'bg-indigo-500' },
  { name: 'Rose', value: 'bg-rose-500' },
  { name: 'Emerald', value: 'bg-emerald-500' },
  { name: 'Amber', value: 'bg-amber-500' },
  { name: 'Cyan', value: 'bg-cyan-500' },
  { name: 'Purple', value: 'bg-purple-500' },
  { name: 'Pink', value: 'bg-pink-500' },
  { name: 'Teal', value: 'bg-teal-500' },
];

export default function AddClassDialog({ open, onOpenChange, onSubmit, isLoading, onUseShareCode }) {
  const [formData, setFormData] = useState({
    name: '',
    teacher: '',
    schedule: '',
    color: 'bg-indigo-500',
    icon: ''
  });

  const generateJoinCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const getIconForSubject = (name) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('math') || lowerName.includes('calculus') || lowerName.includes('algebra')) return 'Calculator';
    if (lowerName.includes('science') || lowerName.includes('biology') || lowerName.includes('chemistry') || lowerName.includes('physics')) return 'Atom';
    if (lowerName.includes('english') || lowerName.includes('literature') || lowerName.includes('writing')) return 'BookOpen';
    if (lowerName.includes('history') || lowerName.includes('social')) return 'Landmark';
    if (lowerName.includes('art') || lowerName.includes('design')) return 'Palette';
    if (lowerName.includes('music')) return 'Music';
    if (lowerName.includes('computer') || lowerName.includes('coding') || lowerName.includes('programming')) return 'Code';
    if (lowerName.includes('language') || lowerName.includes('french') || lowerName.includes('spanish')) return 'Languages';
    if (lowerName.includes('gym') || lowerName.includes('physical') || lowerName.includes('pe')) return 'Dumbbell';
    return 'BookOpen';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const icon = formData.icon || getIconForSubject(formData.name);
    onSubmit({ ...formData, icon, join_code: generateJoinCode() });
    setFormData({ name: '', teacher: '', schedule: '', color: 'bg-indigo-500', icon: '' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Add Class</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Class Name</Label>
            <Input
              id="name"
              placeholder="e.g., Mathematics, English Literature"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="teacher">Teacher (optional)</Label>
            <Input
              id="teacher"
              placeholder="e.g., Mr. Smith"
              value={formData.teacher}
              onChange={(e) => setFormData({ ...formData, teacher: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="schedule">Schedule (optional)</Label>
            <Input
              id="schedule"
              placeholder="e.g., Mon/Wed/Fri 9:00 AM"
              value={formData.schedule}
              onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CLASS_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`w-8 h-8 rounded-full ${color.value} transition-all ${
                    formData.color === color.value 
                      ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' 
                      : 'hover:scale-110'
                  }`}
                  onClick={() => setFormData({ ...formData, color: color.value })}
                />
              ))}
            </div>
          </div>
          
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm text-indigo-700">
            <p className="font-medium">🎓 You'll be the class creator</p>
            <p className="text-xs mt-1 text-indigo-600">Get a share code to invite classmates after creating</p>
          </div>
          
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              'Add Class'
            )}
          </Button>
          {onUseShareCode && (
            <p className="text-center text-sm text-slate-500">
              A classmate already set it up?{' '}
              <button type="button" onClick={onUseShareCode} className="font-medium text-indigo-600 hover:text-indigo-500">
                Use their share code
              </button>
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
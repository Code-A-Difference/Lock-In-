import React from 'react';
import { BookOpen, Calculator, Atom, Landmark, Palette, Music, Code, Languages, Dumbbell, Lightbulb, Globe, FlaskConical, Scale, Binary, Dna, Microscope, Newspaper, Feather, Drama, Ruler } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export const iconOptions = [
  { name: 'Book', value: 'BookOpen', icon: BookOpen, category: 'General' },
  { name: 'Calculator', value: 'Calculator', icon: Calculator, category: 'Math' },
  { name: 'Square Root', value: 'Binary', icon: Binary, category: 'Math' },
  { name: 'Ruler', value: 'Ruler', icon: Ruler, category: 'Math' },
  { name: 'Atom', value: 'Atom', icon: Atom, category: 'Science' },
  { name: 'Flask', value: 'FlaskConical', icon: FlaskConical, category: 'Science' },
  { name: 'DNA', value: 'Dna', icon: Dna, category: 'Science' },
  { name: 'Microscope', value: 'Microscope', icon: Microscope, category: 'Science' },
  { name: 'Monument', value: 'Landmark', icon: Landmark, category: 'History' },
  { name: 'Globe', value: 'Globe', icon: Globe, category: 'Geography' },
  { name: 'Newspaper', value: 'Newspaper', icon: Newspaper, category: 'Social' },
  { name: 'Palette', value: 'Palette', icon: Palette, category: 'Arts' },
  { name: 'Drama', value: 'Drama', icon: Drama, category: 'Arts' },
  { name: 'Music', value: 'Music', icon: Music, category: 'Arts' },
  { name: 'Code', value: 'Code', icon: Code, category: 'Tech' },
  { name: 'Language', value: 'Languages', icon: Languages, category: 'Language' },
  { name: 'Feather', value: 'Feather', icon: Feather, category: 'English' },
  { name: 'Dumbbell', value: 'Dumbbell', icon: Dumbbell, category: 'PE' },
  { name: 'Lightbulb', value: 'Lightbulb', icon: Lightbulb, category: 'General' },
  { name: 'Scale', value: 'Scale', icon: Scale, category: 'Law' },
];

export default function IconSelector({ selectedIcon, onSelect, color = 'bg-indigo-500' }) {
  return (
    <div className="space-y-2">
      <Label className="text-slate-700 dark:text-slate-300">Icon</Label>
      <ScrollArea className="h-48 w-full rounded-lg border dark:border-slate-600 p-3 bg-white dark:bg-slate-700">
        <div className="grid grid-cols-5 gap-2">
          {iconOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-lg transition-all",
                  selectedIcon === option.value 
                    ? "bg-indigo-100 dark:bg-indigo-900/40 ring-2 ring-indigo-500" 
                    : "hover:bg-slate-100 dark:hover:bg-slate-600"
                )}
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", color)}>
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <span className="text-[10px] text-slate-600 dark:text-slate-400">{option.name}</span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
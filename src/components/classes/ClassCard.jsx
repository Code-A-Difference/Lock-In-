import React from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Clock, Trash2, Users, Info, Pencil, LogOut, BookOpen, Calculator, Atom, Landmark, Palette, Music, Code, Languages, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap = {
  Calculator, Atom, BookOpen, Landmark, Palette, Music, Code, Languages, Dumbbell
};

export default function ClassCard({ classItem, isOwner, homeworkCount, testCount, onEdit, onLeave, onDelete, onShowDetails, onHomeworkClick, onTestClick }) {
  const IconComponent = iconMap[classItem.icon] || BookOpen;
  return (
    <Card className="overflow-hidden transition-all duration-300 hover:shadow-lg group">
      <div className={cn("h-2", classItem.color || "bg-indigo-500")} />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", classItem.color || "bg-indigo-500")}>
            <IconComponent className="w-4 h-4 text-white" />
          </div>
        </div>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-slate-800 text-lg">
              {classItem.name}
            </h3>
            {classItem.teacher && (
              <p className="text-sm text-slate-500 flex items-center gap-1 mt-1">
                <User className="w-3.5 h-3.5" />
                {classItem.teacher}
              </p>
            )}
            {classItem.schedule && (
              <p className="text-sm text-slate-400 flex items-center gap-1 mt-1">
                <Clock className="w-3.5 h-3.5" />
                {classItem.schedule}
              </p>
            )}
            <p className="text-xs text-slate-400 flex items-center gap-1 mt-2">
              <Users className="w-3 h-3" />
              {classItem.members?.length || 0} members
            </p>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-indigo-500"
              onClick={() => onShowDetails(classItem)}
            >
              <Info className="w-4 h-4" />
            </Button>
            {isOwner && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-blue-500"
                onClick={() => onEdit(classItem)}
              >
                <Pencil className="w-4 h-4" />
              </Button>
            )}
            {!isOwner && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-amber-500"
                onClick={() => onLeave(classItem)}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
            {isOwner && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-red-500"
                onClick={() => onDelete(classItem)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100">
          <button 
            onClick={() => onHomeworkClick(classItem)}
            className="text-center flex-1 hover:bg-slate-50 rounded-lg p-2 transition-colors cursor-pointer"
          >
            <p className="text-2xl font-bold text-slate-700">{homeworkCount}</p>
            <p className="text-xs text-slate-400">Homework</p>
          </button>
          <div className="w-px h-8 bg-slate-100" />
          <button 
            onClick={() => onTestClick(classItem)}
            className="text-center flex-1 hover:bg-slate-50 rounded-lg p-2 transition-colors cursor-pointer"
          >
            <p className="text-2xl font-bold text-slate-700">{testCount}</p>
            <p className="text-xs text-slate-400">Tests</p>
          </button>
        </div>
      </div>
    </Card>
  );
}
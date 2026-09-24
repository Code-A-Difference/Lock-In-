import React from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { format, isToday, isTomorrow, differenceInCalendarDays, startOfDay } from "date-fns";
import { Calendar, User, Trash2, Pencil, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const priorityConfig = {
  low: { label: 'Low', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  asap: { label: 'ASAP!', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
};

export default function HomeworkCard({ homework, onToggleComplete, onEdit, onDelete, isOwner = true }) {
  const dueDate = new Date(homework.due_date + 'T00:00:00');
  const today = startOfDay(new Date());
  const isPastDue = dueDate < today;
  const isDueToday = isToday(dueDate);
  const isDueTomorrow = isTomorrow(dueDate);

  const getDueDateLabel = () => {
    if (isDueToday) return "Due Today";
    if (isDueTomorrow) return "Due Tomorrow";
    if (isPastDue) return "Overdue";
    const daysUntil = differenceInCalendarDays(dueDate, today);
    if (daysUntil <= 7) return `In ${daysUntil} days`;
    return format(dueDate, "MMM d");
  };

  const priority = homework.priority || 'medium';

  return (
    <Card className={cn(
      "p-4 transition-all duration-300 hover:shadow-lg border-l-4",
      homework.is_completed ? "opacity-60 border-l-emerald-400" : 
      isPastDue ? "border-l-red-400" :
      isDueToday ? "border-l-amber-400" :
      "border-l-slate-200"
    )}>
      <div className="flex items-start gap-3">
        {isOwner && (
          <Checkbox
            checked={homework.is_completed}
            onCheckedChange={() => onToggleComplete(homework)}
            className="mt-1"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={cn(
              "font-medium text-slate-800",
              homework.is_completed && "line-through text-slate-400"
            )}>
              {homework.title}
            </h3>
            <Badge variant="secondary" className="text-xs font-normal">
              {homework.class_name}
            </Badge>
            <Badge className={cn("text-xs font-normal", priorityConfig[priority].color)}>
              {priority === 'asap' && <AlertTriangle className="w-3 h-3 mr-1" />}
              {priorityConfig[priority].label}
            </Badge>
          </div>
          
          {homework.description && (
            <p className="text-sm text-slate-500 mt-1 line-clamp-2">
              {homework.description}
            </p>
          )}
          
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
            <span className={cn(
              "flex items-center gap-1",
              isPastDue && !homework.is_completed && "text-red-500 font-medium",
              isDueToday && !homework.is_completed && "text-amber-600 font-medium"
            )}>
              <Calendar className="w-3.5 h-3.5" />
              {getDueDateLabel()}
            </span>
            {homework.author_name && (
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                {homework.author_name}
              </span>
            )}
          </div>
        </div>
        
        {isOwner && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-blue-500"
              onClick={() => onEdit(homework)}
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-red-500"
              onClick={() => onDelete(homework)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
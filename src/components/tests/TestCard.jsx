import React from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, isPast, isToday, isTomorrow, differenceInCalendarDays, startOfDay } from "date-fns";
import { BookOpen, Trash2, AlertTriangle, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export default function TestCard({ test, onEdit, onDelete, isOwner = true }) {
  const testDate = new Date(test.date + 'T00:00:00');
  const today = startOfDay(new Date());
  const isPastTest = testDate < today;
  const isTestToday = isToday(testDate);
  const isTestTomorrow = isTomorrow(testDate);
  const daysUntil = differenceInCalendarDays(testDate, today);

  const getUrgencyColor = () => {
    if (isPastTest) return "bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700";
    if (isTestToday) return "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800";
    if (daysUntil <= 3) return "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800";
    if (daysUntil <= 7) return "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800";
    return "bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700";
  };

  const getDateLabel = () => {
    if (isPastTest) return "Completed";
    if (isTestToday) return "TODAY";
    if (isTestTomorrow) return "Tomorrow";
    if (daysUntil <= 7) return `In ${daysUntil} days`;
    return format(testDate, "MMM d");
  };

  return (
    <Card className={cn(
      "p-4 transition-all duration-300 hover:shadow-lg border",
      getUrgencyColor()
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {isTestToday && (
              <AlertTriangle className="w-4 h-4 text-red-500" />
            )}
            <h3 className={cn(
              "font-semibold text-slate-800",
              isPastTest && "text-slate-400"
            )}>
              {test.title}
            </h3>
            <Badge variant="secondary" className="text-xs font-normal">
              {test.class_name}
            </Badge>
          </div>
          
          {test.notes && (
            <p className="text-sm text-slate-500 mb-3 line-clamp-2">
              {test.notes}
            </p>
          )}
          
          <div className="flex items-center gap-4 text-sm">
            <span className={cn(
              "font-medium",
              isPastTest ? "text-slate-400" :
              isTestToday ? "text-red-600" :
              daysUntil <= 3 ? "text-amber-600" :
              "text-slate-600"
            )}>
              {getDateLabel()}
            </span>
            <span className="text-slate-400">
              {format(testDate, "EEEE, MMM d")}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center",
            isPastTest ? "bg-slate-200" :
            isTestToday ? "bg-red-500" :
            daysUntil <= 3 ? "bg-amber-500" :
            "bg-indigo-500"
          )}>
            <BookOpen className={cn(
              "w-5 h-5",
              isPastTest ? "text-slate-400" : "text-white"
            )} />
          </div>
          {isOwner && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-blue-500"
                onClick={() => onEdit(test)}
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-red-500"
                onClick={() => onDelete(test)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
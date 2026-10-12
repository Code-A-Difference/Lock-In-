import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, BookOpen, ClipboardList } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";

export default function CalendarView({ homework = [], tests = [], onHomeworkClick, onTestClick, selectedDay, onDayClick }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const startDay = monthStart.getDay();
  const paddingDays = Array(startDay).fill(null);

  const getItemsForDay = (day) => {
    const dayHomework = homework.filter(h => {
      const dueDate = new Date(h.due_date + 'T00:00:00');
      return isSameDay(dueDate, day);
    });
    const dayTests = tests.filter(t => {
      const testDate = new Date(t.date + 'T00:00:00');
      return isSameDay(testDate, day);
    });
    return { homework: dayHomework, tests: dayTests };
  };

  return (
    <Card className="p-4 dark:bg-slate-800 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h2 className="text-lg font-semibold text-foreground">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {paddingDays.map((_, idx) => (
          <div key={`pad-${idx}`} className="h-24 bg-slate-50 dark:bg-slate-900/50 rounded-lg" />
        ))}
        
        {days.map(day => {
          const items = getItemsForDay(day);
          const hasItems = items.homework.length > 0 || items.tests.length > 0;
          
          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick?.(startOfDay(day))}
              className={cn(
                "h-24 p-1 rounded-lg border transition-colors overflow-hidden",
                selectedDay && isSameDay(day, selectedDay) ? "bg-indigo-100 border-indigo-400 dark:bg-indigo-900/40 dark:border-indigo-500" :
                isToday(day) ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700" : "bg-card border-border",
                !isSameMonth(day, currentMonth) && "opacity-50",
                onDayClick && "cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600"
              )}
            >
              {onDayClick ? (
                <button type="button" aria-label={format(day, "EEEE, MMMM d")}
                  onClick={e => { e.stopPropagation(); onDayClick(startOfDay(day)); }}
                  className={cn(
                    "mb-1 -ml-0.5 min-w-6 rounded px-1 text-left text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                    isToday(day) ? "text-primary" : "text-muted-foreground"
                  )}>
                  {format(day, "d")}
                </button>
              ) : (
                <div className={cn("mb-1 text-xs font-medium", isToday(day) ? "text-primary" : "text-muted-foreground")}>
                  {format(day, "d")}
                </div>
              )}
              
              <div className="space-y-0.5 overflow-y-auto max-h-16">
                {items.tests.slice(0, 2).map(test => (
                  <button
                    type="button"
                    key={test.id}
                    onClick={e => { e.stopPropagation(); onTestClick?.(test); }}
                    className="block w-full text-left text-xs px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 truncate hover:bg-red-200 dark:hover:bg-red-900/60"
                  >
                    <BookOpen className="w-2.5 h-2.5 inline mr-0.5" aria-hidden="true" />
                    <span className="sr-only">Test: </span>{test.title}
                  </button>
                ))}
                {items.homework.slice(0, 2).map(hw => (
                  <button
                    type="button"
                    key={hw.id}
                    onClick={e => { e.stopPropagation(); onHomeworkClick?.(hw); }}
                    className={cn(
                      "block w-full text-left text-xs px-1 py-0.5 rounded truncate",
                      hw.is_completed 
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" 
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60"
                    )}
                  >
                    <ClipboardList className="w-2.5 h-2.5 inline mr-0.5" aria-hidden="true" />
                    <span className="sr-only">{hw.is_completed ? 'Done: ' : 'Homework: '}</span>{hw.title}
                  </button>
                ))}
                {(items.homework.length + items.tests.length) > 4 && (
                  <div className="text-xs text-muted-foreground px-1">
                    +{items.homework.length + items.tests.length - 4} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/40" />
          <span>Tests</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/40" />
          <span>Homework</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-emerald-100 dark:bg-emerald-900/40" />
          <span>Completed</span>
        </div>
      </div>
    </Card>
  );
}
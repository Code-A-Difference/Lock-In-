import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Target, Upload, Trash2, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function StudyHistorySidebar({ 
  history = [], 
  onSelectItem, 
  onDeleteItem,
  activeType,
  isLoading 
}) {
  const filteredHistory = activeType === 'all' 
    ? history 
    : history.filter(h => h.type === activeType);

  const getIcon = (type) => {
    switch (type) {
      case 'conversation': return MessageSquare;
      case 'quiz': return Target;
      case 'grading': return Upload;
      default: return Clock;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'conversation': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400';
      case 'quiz': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'grading': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
    }
  };

  if (isLoading) {
    return (
      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <CardHeader className="py-3">
          <CardTitle className="text-sm text-slate-600 dark:text-slate-300">History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-slate-400">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="dark:bg-slate-800 dark:border-slate-700">
      <CardHeader className="py-3">
        <CardTitle className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <Clock className="w-4 h-4" />
          History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          {filteredHistory.length === 0 ? (
            <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm px-4">
              No history yet. Start a conversation, take a quiz, or grade homework!
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {filteredHistory.map((item) => {
                const Icon = getIcon(item.type);
                return (
                  <div
                    key={item.id}
                    className="group flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
                    onClick={() => onSelectItem(item)}
                  >
                    <div className={cn("p-1.5 rounded", getTypeColor(item.type))}>
                      <Icon className="w-3 h-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {format(new Date(item.created_date), 'MMM d, h:mm a')}
                        </span>
                        {item.score && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">
                            {item.score}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteItem(item.id);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
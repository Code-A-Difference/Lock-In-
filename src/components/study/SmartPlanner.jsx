import { db } from '@/api/db';

import React, { useState } from 'react';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Plus, Trash2, Sparkles, Loader2, BookOpen, ClipboardList, Coffee, AlertCircle } from "lucide-react";
import { format } from "date-fns";

const TASK_TYPE_META = {
  homework: { icon: ClipboardList, color: 'amber', bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
  study: { icon: BookOpen, color: 'red', bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800' },
  break: { icon: Coffee, color: 'emerald', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
};

export default function SmartPlanner({ homework, tests, upcomingTest }) {
  const [freeSlots, setFreeSlots] = useState([]);
  const [slotDate, setSlotDate] = useState('');
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [extraNotes, setExtraNotes] = useState('');
  const [schedule, setSchedule] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  const addSlot = () => {
    if (!slotDate || !slotStart || !slotEnd) return;
    setFreeSlots([...freeSlots, { id: Date.now(), date: slotDate, start: slotStart, end: slotEnd }]);
    setSlotDate('');
    setSlotStart('');
    setSlotEnd('');
  };

  const removeSlot = (id) => {
    setFreeSlots(freeSlots.filter(s => s.id !== id));
  };

  const pendingHomework = homework.filter(h => !h.is_completed);

  const handleGenerate = async () => {
    if (freeSlots.length === 0) {
      setError('Please add at least one free time slot.');
      return;
    }
    if (pendingHomework.length === 0 && tests.length === 0) {
      setError('You have no pending homework or upcoming tests to schedule.');
      return;
    }

    setError('');
    setIsGenerating(true);
    setSchedule(null);

    try {
      const homeworkData = pendingHomework.map(h => ({
        title: h.title,
        class: h.class_name,
        due_date: h.due_date,
        priority: h.priority,
        description: h.description || ''
      }));

      const testsData = tests.map(t => ({
        title: t.title,
        class: t.class_name,
        date: t.date,
        notes: t.notes || ''
      }));

      const slotsData = freeSlots.map(s => ({
        date: s.date,
        start: s.start,
        end: s.end
      }));

      const prompt = `You are an expert academic scheduler helping a student organize their study time.

The student has these PENDING HOMEWORK assignments (with priority levels low/medium/high/asap):
${JSON.stringify(homeworkData, null, 2)}

The student has these UPCOMING TESTS to study for:
${JSON.stringify(testsData, null, 2)}

The student has indicated these FREE TIME blocks when they are available to study/work:
${JSON.stringify(slotsData, null, 2)}

${extraNotes ? `Additional notes from the student: ${extraNotes}` : ''}

Today's date is ${format(new Date(), 'yyyy-MM-dd')}.

Create an optimized study schedule that fits ALL the work into the available free time blocks. Follow these rules:
1. Prioritize by urgency and importance: "asap" and "high" priority homework due soonest come first; tests that are sooner or in harder subjects get more study time.
2. For tests, allocate dedicated study sessions spread across available days leading up to the test date.
3. Break long sessions into focused blocks (no longer than 90 minutes) with short breaks in between.
4. Schedule homework so it's completed before its due date.
5. Each schedule block must fit within one of the student's free time slots (do not schedule outside their availability).
6. Provide a clear reason for each block explaining why it was prioritized that way.
7. If there isn't enough free time to fit everything, fit what you can in priority order and note the overflow in the "notes" field at the end.

Return ONLY valid JSON in this exact format:
{
  "blocks": [
    {
      "date": "YYYY-MM-DD",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "title": "Short title of what to work on",
      "type": "homework" | "study" | "break",
      "priority": "high" | "medium" | "low",
      "reason": "Why this was scheduled here and its priority"
    }
  ],
  "summary": "A 2-3 sentence overview of the plan and what to focus on most",
  "notes": "Any overflow items that didn't fit, or tips for the student"
}`;

      const response = await db.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  start_time: { type: "string" },
                  end_time: { type: "string" },
                  title: { type: "string" },
                  type: { type: "string" },
                  priority: { type: "string" },
                  reason: { type: "string" }
                }
              }
            },
            summary: { type: "string" },
            notes: { type: "string" }
          }
        }
      });

      setSchedule(response);
    } catch (e) {
      setError(e?.message || 'Something went wrong generating your schedule. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-indigo-100 dark:border-indigo-900">
        <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
          <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            AI Study Planner
          </CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Tell us when you're free — we'll build a smart schedule around your homework and test prep.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {/* Free time input */}
          <div className="space-y-3">
            <Label className="text-base font-semibold text-slate-700 dark:text-slate-300">Your Free Time</Label>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <Input
                type="date"
                value={slotDate}
                onChange={(e) => setSlotDate(e.target.value)}
                className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
              />
              <Input
                type="time"
                value={slotStart}
                onChange={(e) => setSlotStart(e.target.value)}
                className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
              />
              <Input
                type="time"
                value={slotEnd}
                onChange={(e) => setSlotEnd(e.target.value)}
                className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
              />
              <Button onClick={addSlot} disabled={!slotDate || !slotStart || !slotEnd} className="bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700">
                <Plus className="w-4 h-4 mr-1" />
                Add Slot
              </Button>
            </div>

            {freeSlots.length > 0 ? (
              <div className="space-y-2">
                {freeSlots.map(slot => (
                  <div key={slot.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                      <Calendar className="w-4 h-4 text-indigo-500" />
                      <span className="font-medium">{format(new Date(slot.date + 'T00:00:00'), 'EEE, MMM d')}</span>
                      <Clock className="w-4 h-4 text-slate-400 ml-1" />
                      <span>{slot.start} – {slot.end}</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeSlot(slot.id)} className="h-7 w-7 text-slate-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 dark:text-slate-500">No free time added yet. Add the blocks when you're available to study.</p>
            )}
          </div>

          {/* Extra notes */}
          <div className="space-y-2">
            <Label className="text-base font-semibold text-slate-700 dark:text-slate-300">Anything we should know? (optional)</Label>
            <Textarea
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              placeholder="e.g., I struggle most with Chemistry, prefer studying in the mornings, have practice Tuesdays after 4pm..."
              rows={2}
              className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
            />
          </div>

          {/* Summary of what will be scheduled */}
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <ClipboardList className="w-3.5 h-3.5" />
              {pendingHomework.length} pending task{pendingHomework.length !== 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
              <BookOpen className="w-3.5 h-3.5" />
              {tests.length} upcoming test{tests.length !== 1 ? 's' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Clock className="w-3.5 h-3.5" />
              {freeSlots.length} free block{freeSlots.length !== 1 ? 's' : ''}
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || freeSlots.length === 0}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-lg py-6"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Building your schedule...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate My Study Schedule
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {schedule && (
        <div className="space-y-4">
          {schedule.summary && (
            <Card className="border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-300 mb-1">Plan Overview</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{schedule.summary}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {schedule.blocks && schedule.blocks.length > 0 ? (
            <div className="space-y-3">
              {schedule.blocks
                .slice()
                .sort((a, b) => {
                  if (a.date !== b.date) return a.date.localeCompare(b.date);
                  return (a.start_time || '').localeCompare(b.start_time || '');
                })
                .map((block, idx) => {
                  const meta = TASK_TYPE_META[block.type] || TASK_TYPE_META.study;
                  const Icon = meta.icon;
                  return (
                    <Card key={idx} className={`${meta.border} dark:bg-slate-800 overflow-hidden`}>
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-xl ${meta.bg} flex items-center justify-center flex-shrink-0`}>
                            <Icon className={`w-5 h-5 ${meta.text}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <p className="font-medium text-slate-800 dark:text-slate-200">{block.title}</p>
                              {block.priority && (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${meta.bg} ${meta.text} border ${meta.border}`}>
                                  {block.priority}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mb-2">
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                {block.date && format(new Date(block.date + 'T00:00:00'), 'EEE, MMM d')}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {block.start_time} – {block.end_time}
                              </span>
                            </div>
                            {block.reason && (
                              <p className="text-sm text-slate-600 dark:text-slate-400">{block.reason}</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          ) : (
            <Card className="dark:bg-slate-800">
              <CardContent className="pt-6 text-center text-slate-500 dark:text-slate-400">
                No blocks were generated. Try adjusting your free time or tasks.
              </CardContent>
            </Card>
          )}

          {schedule.notes && (
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-300 mb-1">Notes</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{schedule.notes}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Button
            variant="outline"
            onClick={() => setSchedule(null)}
            className="w-full dark:text-slate-200 dark:hover:bg-slate-700 dark:border-slate-600"
          >
            Generate a New Schedule
          </Button>
        </div>
      )}
    </div>
  );
}
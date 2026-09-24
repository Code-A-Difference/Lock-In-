import { db, sharing } from '@/api/db';
import { toast } from '@/components/ui/use-toast';

import React, { useState, useEffect } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Share2, BookOpen, ClipboardList, GraduationCap, Sparkles, CalendarDays, Clock, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { format, isToday, isTomorrow, startOfDay, addDays, isSameDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

import HomeworkCard from "../components/homework/HomeworkCard";
import AddHomeworkDialog from "../components/homework/AddHomeworkDialog";
import TestCard from "../components/tests/TestCard";
import AddTestDialog from "../components/tests/AddTestDialog";
import ClassCard from "../components/classes/ClassCard";
import AddClassDialog from "../components/classes/AddClassDialog";
import JoinClassDialog from "../components/classes/JoinClassDialog";
import ClassDetailsDialog from "../components/classes/ClassDetailsDialog";
import EditClassDialog from "../components/classes/EditClassDialog";
import EditHomeworkDialog from "../components/homework/EditHomeworkDialog";
import EditTestDialog from "../components/tests/EditTestDialog";
import CalendarView from "../components/calendar/CalendarView";
import SmartPlanner from "../components/study/SmartPlanner";

// A greeting beats repeating the product name at someone who already knows
// which app they opened.
function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Winding down';
}

export default function Home() {
  const [showHomeworkDialog, setShowHomeworkDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [showClassDialog, setShowClassDialog] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showEditClassDialog, setShowEditClassDialog] = useState(false);
  const [showEditHomeworkDialog, setShowEditHomeworkDialog] = useState(false);
  const [showEditTestDialog, setShowEditTestDialog] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);
  const [selectedHomework, setSelectedHomework] = useState(null);
  const [selectedTest, setSelectedTest] = useState(null);
  const [selectedDay, setSelectedDay] = useState(startOfDay(new Date()));
  const [showClasses, setShowClasses] = useState(false);
  const [user, setUser] = useState(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    db.auth.me().then(userData => {
      setUser(userData);
      if (userData.dark_mode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }).catch(() => {});
  }, []);

  const { data: allClasses = [], isLoading: classesLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: () => db.entities.Class.list()
  });

  const classes = allClasses.filter(c => 
    c.members?.includes(user?.email)
  );

  const { data: allHomework = [], isLoading: homeworkLoading } = useQuery({
    queryKey: ['homework'],
    queryFn: () => db.entities.Homework.list('-due_date')
  });

  const homework = allHomework.filter(hw => 
    classes.some(c => c.name === hw.class_name)
  );

  const { data: allTests = [], isLoading: testsLoading } = useQuery({
    queryKey: ['tests'],
    queryFn: () => db.entities.Test.list('-date')
  });

  const tests = allTests.filter(test => 
    classes.some(c => c.name === test.class_name)
  );

  const createClassMutation = useMutation({
    mutationFn: (data) => db.entities.Class.create({
      ...data,
      members: [user?.email]
    }),
    onSuccess: (newClass) => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      setShowClassDialog(false);
      setSelectedClass(newClass);
      setShowDetailsDialog(true);
    }
  });

  // No shared database to look a short code up in, so a share code carries the
  // class itself (api/db.js → sharing). Importing the same code again later
  // only adds what is new, which is how a classmate's updates reach you.
  const joinClassMutation = useMutation({
    mutationFn: (code) => sharing.importClass(code),
    onSuccess: (r) => {
      ['classes', 'homework', 'tests'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      setShowJoinDialog(false);
      setShowClasses(true);
      toast({
        title: r.isNew ? `Added ${r.className}` : `Updated ${r.className}`,
        description: r.added
          ? `${r.added} new item${r.added === 1 ? '' : 's'}${r.from ? ` from ${r.from}` : ''}.`
          : 'You already had everything in that code.',
      });
    },
    onError: (error) => toast({ title: 'Could not add that class', description: error.message, variant: 'destructive' })
  });

  const updateClassMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.Class.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      setShowEditClassDialog(false);
      setSelectedClass(null);
    }
  });

  const leaveClassMutation = useMutation({
    mutationFn: async (classItem) => {
      const updatedMembers = classItem.members.filter(m => m !== user?.email);
      await db.entities.Class.update(classItem.id, { members: updatedMembers });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['classes'] })
  });

  // Take the class's homework and tests with it. They are filtered by class
  // name, so left behind they would be invisible but still stored forever.
  const deleteClassMutation = useMutation({
    mutationFn: async (id) => {
      const cls = allClasses.find(c => c.id === id);
      if (cls) {
        for (const h of allHomework.filter(x => x.class_name === cls.name)) await db.entities.Homework.delete(h.id);
        for (const t of allTests.filter(x => x.class_name === cls.name)) await db.entities.Test.delete(t.id);
      }
      await db.entities.Class.delete(id);
    },
    onSuccess: () => ['classes', 'homework', 'tests'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }))
  });

  const createHomeworkMutation = useMutation({
    mutationFn: (data) => db.entities.Homework.create({
      ...data,
      is_shared: true,
      author_name: user?.full_name || 'Anonymous'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] });
      queryClient.invalidateQueries({ queryKey: ['shared-homework'] });
      setShowHomeworkDialog(false);
    }
  });

  const updateHomeworkMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.Homework.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] });
      queryClient.invalidateQueries({ queryKey: ['shared-homework'] });
      setShowEditHomeworkDialog(false);
      setSelectedHomework(null);
    }
  });

  const deleteHomeworkMutation = useMutation({
    mutationFn: (id) => db.entities.Homework.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] });
      queryClient.invalidateQueries({ queryKey: ['shared-homework'] });
    }
  });

  const createTestMutation = useMutation({
    mutationFn: (data) => db.entities.Test.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tests'] });
      setShowTestDialog(false);
    }
  });

  const updateTestMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.Test.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tests'] });
      setShowEditTestDialog(false);
      setSelectedTest(null);
    }
  });

  const deleteTestMutation = useMutation({
    mutationFn: (id) => db.entities.Test.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tests'] })
  });

  const today = startOfDay(new Date());
  const pendingHomework = homework.filter(h => !h.is_completed);
  const completedHomework = homework.filter(h => h.is_completed);
  const upcomingTests = tests.filter(t => new Date(t.date + 'T00:00:00') >= today);

  const isLoading = classesLoading || homeworkLoading || testsLoading;

  // Items for the selected day
  const dayHomework = homework.filter(h => isSameDay(new Date(h.due_date + 'T00:00:00'), selectedDay));
  const dayTests = tests.filter(t => isSameDay(new Date(t.date + 'T00:00:00'), selectedDay));

  const dayLabel = isToday(selectedDay) ? "Today" : isTomorrow(selectedDay) ? "Tomorrow" : format(selectedDay, "EEEE, MMMM d");

  const getHomeworkCountForClass = (className) => 
    homework.filter(h => h.class_name === className && !h.is_completed).length;
  
  const getTestCountForClass = (className) => 
    tests.filter(t => t.class_name === className).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Page heading. The brand lives in the app header now, so this says
            what the page is rather than repeating the product name. */}
        <div className="flex flex-col gap-4 mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {greeting()}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {format(new Date(), "EEEE, MMMM d")} · {pendingHomework.length === 0 && upcomingTests.length === 0
                ? "nothing due — enjoy it"
                : `${pendingHomework.length} to do, ${upcomingTests.length} test${upcomingTests.length === 1 ? '' : 's'} coming up`}
            </p>
          </div>

          {/* Quick add. Its own row on small screens; nothing floats over it. */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowHomeworkDialog(true)} size="sm" className="bg-amber-500 hover:bg-amber-600">
              <Plus className="w-4 h-4 mr-1" /> Homework
            </Button>
            <Button onClick={() => setShowTestDialog(true)} size="sm" className="bg-red-500 hover:bg-red-600">
              <Plus className="w-4 h-4 mr-1" /> Test
            </Button>
            <Button onClick={() => setShowClassDialog(true)} size="sm" className="bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700">
              <Plus className="w-4 h-4 mr-1" /> Class
            </Button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <ClipboardList className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{pendingHomework.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pending Tasks</p>
              </div>
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{upcomingTests.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Upcoming Tests</p>
              </div>
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                <GraduationCap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{classes.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Classes</p>
              </div>
            </div>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{completedHomework.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Completed</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Main: Calendar + Selected Day */}
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2"><Skeleton className="h-[520px] rounded-2xl" /></div>
            <Skeleton className="h-[520px] rounded-2xl" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2">
              <CalendarView
                homework={homework}
                tests={tests}
                selectedDay={selectedDay}
                onDayClick={(day) => setSelectedDay(day)}
                onHomeworkClick={(hw) => { setSelectedHomework(hw); setShowEditHomeworkDialog(true); }}
                onTestClick={(t) => { setSelectedTest(t); setShowEditTestDialog(true); }}
              />
            </div>

            {/* Selected Day panel */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-indigo-500" />
                  {dayLabel}
                </h2>
                <span className="text-xs text-slate-400 dark:text-slate-500">{format(selectedDay, "MMM d, yyyy")}</span>
              </div>

              {dayTests.length === 0 && dayHomework.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                    <Sparkles className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nothing due this day.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {dayTests.map(test => (
                    <TestCard
                      key={test.id}
                      test={test}
                      isOwner={test.created_by === user?.email}
                      onEdit={(t) => { setSelectedTest(t); setShowEditTestDialog(true); }}
                      onDelete={(t) => deleteTestMutation.mutate(t.id)}
                    />
                  ))}
                  {dayHomework.map(hw => (
                    <HomeworkCard
                      key={hw.id}
                      homework={hw}
                      isOwner={hw.created_by === user?.email}
                      onToggleComplete={(h) => updateHomeworkMutation.mutate({ id: h.id, data: { is_completed: !h.is_completed } })}
                      onEdit={(h) => { setSelectedHomework(h); setShowEditHomeworkDialog(true); }}
                      onDelete={(h) => deleteHomeworkMutation.mutate(h.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI Planner */}
        {!isLoading && (
          <SmartPlanner homework={homework} tests={upcomingTests} upcomingTest={upcomingTests[0]} />
        )}

        {/* Classes (collapsible) */}
        {!classesLoading && classes.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => setShowClasses(!showClasses)}
              className="flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              {showClasses ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              <GraduationCap className="w-5 h-5" />
              <h2 className="text-lg font-semibold">My Classes</h2>
              <span className="text-sm text-slate-400 dark:text-slate-500">({classes.length})</span>
            </button>
            <Button variant="outline" size="sm" onClick={() => setShowJoinDialog(true)}>
              <Share2 className="mr-1.5 h-4 w-4" /> Add a shared class
            </Button>
            </div>

            <AnimatePresence>
              {showClasses && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {classes.map(cls => (
                      <ClassCard
                        key={cls.id}
                        classItem={cls}
                        isOwner={cls.created_by === user?.email}
                        homeworkCount={getHomeworkCountForClass(cls.name)}
                        testCount={getTestCountForClass(cls.name)}
                        onEdit={(c) => { setSelectedClass(c); setShowEditClassDialog(true); }}
                        onLeave={(c) => leaveClassMutation.mutate(c)}
                        onDelete={(c) => deleteClassMutation.mutate(c.id)}
                        onShowDetails={(c) => { setSelectedClass(c); setShowDetailsDialog(true); }}
                        onHomeworkClick={() => {}}
                        onTestClick={() => {}}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <AddHomeworkDialog
        open={showHomeworkDialog}
        onOpenChange={setShowHomeworkDialog}
        classes={classes}
        onSubmit={(data) => createHomeworkMutation.mutate(data)}
        isLoading={createHomeworkMutation.isPending}
      />
      
      <AddTestDialog
        open={showTestDialog}
        onOpenChange={setShowTestDialog}
        classes={classes}
        onSubmit={(data) => createTestMutation.mutate(data)}
        isLoading={createTestMutation.isPending}
      />
      
      <AddClassDialog
        open={showClassDialog}
        onOpenChange={setShowClassDialog}
        onUseShareCode={() => { setShowClassDialog(false); setShowJoinDialog(true); }}
        onSubmit={(data) => createClassMutation.mutate(data)}
        isLoading={createClassMutation.isPending}
      />
      
      <JoinClassDialog
        open={showJoinDialog}
        onOpenChange={setShowJoinDialog}
        onSubmit={(code) => joinClassMutation.mutate(code)}
        isLoading={joinClassMutation.isPending}
      />
      

      
      <ClassDetailsDialog
        open={showDetailsDialog}
        onOpenChange={setShowDetailsDialog}
        classItem={selectedClass}
      />
      
      <EditClassDialog
        open={showEditClassDialog}
        onOpenChange={setShowEditClassDialog}
        classItem={selectedClass}
        onSubmit={(data) => updateClassMutation.mutate({ id: selectedClass.id, data })}
        isLoading={updateClassMutation.isPending}
      />
      
      <EditHomeworkDialog
        open={showEditHomeworkDialog}
        onOpenChange={setShowEditHomeworkDialog}
        homework={selectedHomework}
        onSubmit={(data) => updateHomeworkMutation.mutate({ id: selectedHomework.id, data })}
        isLoading={updateHomeworkMutation.isPending}
      />
      
      <EditTestDialog
        open={showEditTestDialog}
        onOpenChange={setShowEditTestDialog}
        test={selectedTest}
        onSubmit={(data) => updateTestMutation.mutate({ id: selectedTest.id, data })}
        isLoading={updateTestMutation.isPending}
      />
    </div>
  );
}
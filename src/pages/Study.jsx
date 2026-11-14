import { db } from '@/api/db';
import RichText from '@/components/lockin/RichText';

import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Upload, Target, Sparkles, Loader2, GraduationCap, FileText, NotebookPen, Layers, ChevronRight, ChevronLeft, Info } from "lucide-react";
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { classSources, gatherMaterial, classQuizPrompt } from '@/lib/classQuiz';
import { DIFFICULTIES, QUIZ_LENGTHS, TIME_LIMITS, QUIZ_SCHEMA, quizRules, normaliseQuiz, writtenCount, checkPrompt, CHECK_SCHEMA, applyChecks } from '@/lib/quizKit';
import QuizRunner from '@/components/study/QuizRunner';
import Flashcards from '@/components/study/Flashcards';
import { useStudyData } from '@/lib/data';
import { parseDay, daysUntil, relativeDay } from '@/lib/dates';
import StudyHistorySidebar from "../components/study/StudyHistorySidebar";

// The AI Assistant chat and the Planner tab moved out of here: the planner
// is inline on the Today page now, and asking Lock In a question works by
// voice from anywhere (FocusContext.handleVoice), not as a typed chat.
export default function Study() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(['quiz', 'grading', 'cards'].includes(location.state?.tab) ? location.state.tab : 'quiz');

  // Homework grading state
  const [selectedFile, setSelectedFile] = useState(null);
  const [homeworkTitle, setHomeworkTitle] = useState('');
  const [pastedWork, setPastedWork] = useState('');
  const [gradingResult, setGradingResult] = useState(null);
  const [isGrading, setIsGrading] = useState(false);
  const [useTextInput, setUseTextInput] = useState(false);
  
  // Quiz state
  const [selectedTest, setSelectedTest] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [makingStep, setMakingStep] = useState('');

  /* A fast model sometimes writes an answer key that contradicts its own worked
     solution. A short second pass checks each key against its steps and fixes
     the key. If the check itself fails, the quiz is used as it is. */
  const checkKeys = async (questions) => {
    setMakingStep('Checking the answers…');
    try {
      const raw = await db.integrations.Core.InvokeLLM({ feature: 'practice', prompt: checkPrompt(questions), response_json_schema: CHECK_SCHEMA, maxTokens: 1500 });
      return applyChecks(questions, raw);
    } catch (_) {
      return questions;
    } finally { setMakingStep(''); }
  };
  const [answers, setAnswers] = useState({});
  const [writtenAnswers, setWrittenAnswers] = useState({});
  const [quizResults, setQuizResults] = useState(null);
  const [quizDescription, setQuizDescription] = useState('');
  const [quizFiles, setQuizFiles] = useState([]);
  const [customQuizTopic, setCustomQuizTopic] = useState(location.state?.topic || '');
  // "Quiz me" from a lecture's notes: the notes are the source material.
  const lectureNotes = location.state?.notes || '';
  const [customQuizClass, setCustomQuizClass] = useState('');
  const [includeWritten, setIncludeWritten] = useState(false);
  // A whole class: every lecture's notes plus the material added to it.
  const [quizClass, setQuizClass] = useState(location.state?.className || '');
  const [leftOut, setLeftOut] = useState(() => new Set());
  const [quizCount, setQuizCount] = useState(10);
  const [quizFocus, setQuizFocus] = useState('');
  // How every quiz is made and taken
  const [difficulty, setDifficulty] = useState('standard');
  const [timeLimit, setTimeLimit] = useState(0);
  const [runKey, setRunKey] = useState(0);          // a new key = a fresh attempt at the same questions
  const [savedRun, setSavedRun] = useState(null);   // a past attempt opened from history
  const lastMake = React.useRef(null);              // "new questions, same settings"

  const queryClient = useQueryClient();

  const { data: studyHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['studyHistory'],
    queryFn: async () => {
      const currentUser = await db.auth.me();
      return db.entities.StudyHistory.filter(
        { created_by: currentUser.email },
        '-created_date',
        50
      );
    }
  });

  const saveHistoryMutation = useMutation({
    mutationFn: (data) => db.entities.StudyHistory.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studyHistory'] })
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: (id) => db.entities.StudyHistory.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studyHistory'] })
  });

  // Same data, same filtering as every other page. Tests are sorted soonest
  // first, the old list was sorted latest first, so the "upcoming test"
  // banner named the one furthest away.
  const { tests: myTests, classes = [], lectures = [] } = useStudyData();
  const classOptions = classes.filter(c => classSources(lectures, c.name).length);
  const sourcesForClass = quizClass ? classSources(lectures, quizClass) : [];
  const chosenSources = sourcesForClass.filter(x => !leftOut.has(x.id));
  const tests = myTests
    .filter(t => { const d = parseDay(t.date); return d && daysUntil(d) >= 0; })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Deep links: "Quiz me on this" from Today or Focus, "Plan my week".
  useEffect(() => {
    const id = location.state?.testId;
    if (!id || selectedTest) return;
    const t = myTests.find(x => x.id === id);
    if (t) setSelectedTest(t);
  }, [location.state, myTests, selectedTest]);


  // Homework Grading
  const handleFileUpload = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleGradeHomework = async () => {
    if ((!selectedFile && !pastedWork) || !homeworkTitle) return;
    
    setIsGrading(true);
    try {
      let prompt = `You are a teacher grading homework. The assignment is: "${homeworkTitle}". 

Review the submitted work and provide:
1. A grade (A+, A, B+, B, C+, C, D, F)
2. Detailed feedback on what was done well
3. Areas for improvement
4. Specific suggestions for next time

Be constructive, encouraging, and specific.`;

      let response;
      if (useTextInput && pastedWork) {
        prompt += `\n\nStudent's work:\n${pastedWork}`;
        response = await db.integrations.Core.InvokeLLM({ feature: 'practice', prompt });
        setGradingResult(response);
      } else if (selectedFile) {
        const { file_url } = await db.integrations.Core.UploadFile({ file: selectedFile });
        response = await db.integrations.Core.InvokeLLM({ feature: 'practice',
          prompt,
          file_urls: [file_url]
        });
        setGradingResult(response);
      }
      
      // Save grading history
      const gradeMatch = response?.match(/([A-F][+\-]?)/);
      saveHistoryMutation.mutate({
        type: 'grading',
        title: homeworkTitle,
        data: { result: response, work: useTextInput ? pastedWork : 'File uploaded' },
        score: gradeMatch ? gradeMatch[1] : null
      });
    } catch (error) {
      setGradingResult(`Couldn't grade that: ${error?.message || 'please try again.'}`);
    } finally {
      setIsGrading(false);
    }
  };

  /** A quiz on everything for one class: its lectures' notes and the material added to it. */
  const handleClassQuiz = async () => {
    if (!chosenSources.length) return;
    setSelectedTest(null);
    setIsGeneratingQuiz(true);
    setQuiz(null);
    setAnswers({});
    setWrittenAnswers({});
    setQuizResults(null);
    try {
      const { text } = gatherMaterial(chosenSources);
      const response = await db.integrations.Core.InvokeLLM({ feature: 'practice',
        prompt: classQuizPrompt({ className: quizClass, focus: quizFocus.trim(), material: text, count: quizCount, written: writtenCount(quizCount, includeWritten), difficulty }),
        response_json_schema: QUIZ_SCHEMA,
      });
      const { questions: made } = normaliseQuiz(response);
      if (!made.length) throw new Error('The AI sent back no questions.');
      const questions = await checkKeys(made);
      lastMake.current = handleClassQuiz;
      setSavedRun(null);
      setRunKey(k => k + 1);
      setQuiz({ questions, title: `${quizClass}${quizFocus.trim() ? `, ${quizFocus.trim()}` : ''}`, difficulty });
    } catch (error) {
      toast({ title: 'Couldn’t make that quiz', description: error?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  // Quiz Generation
  const handleGenerateQuiz = async (test, customDesc, files, useWritten = false) => {
    setSelectedTest(test);
    setIsGeneratingQuiz(true);
    setQuiz(null);
    setAnswers({});
    setWrittenAnswers({});
    setQuizResults(null);

    try {
      let fileUrls = [];
      if (files && files.length > 0) {
        for (let file of files) {
          const { file_url } = await db.integrations.Core.UploadFile({ file });
          fileUrls.push(file_url);
        }
      }

      const title = test?.title || customQuizTopic;
      const className = test?.class_name || customQuizClass;
      const description = customDesc || test?.notes || '';
      
      const response = await db.integrations.Core.InvokeLLM({ feature: 'practice',
        prompt: `Write a practice quiz for: "${title}"${className ? ` in ${className}` : ''}.
${description ? `Topics, notes or description:\n${description}\n` : ''}${fileUrls.length ? 'Use the attached study material as the source.\n' : ''}
${quizRules({ difficulty, count: quizCount, written: writtenCount(quizCount, useWritten) })}`,
        file_urls: fileUrls.length > 0 ? fileUrls : undefined,
        response_json_schema: QUIZ_SCHEMA,
      });
      const { questions: made } = normaliseQuiz(response);
      if (!made.length) throw new Error('The AI sent back no questions.');
      const questions = await checkKeys(made);
      lastMake.current = () => handleGenerateQuiz(test, customDesc, files, useWritten);
      setSavedRun(null);
      setRunKey(k => k + 1);
      setQuiz({ questions, title, difficulty });
      setQuizDescription('');
      setQuizFiles([]);
      setCustomQuizTopic('');
      setCustomQuizClass('');
    } catch (error) {
      toast({ title: 'Couldn’t make that quiz', description: error?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const saveAttempt = ({ answers: a, grades, score, tookMs, regraded }) => {
    if (regraded) return;
    saveHistoryMutation.mutate({
      type: 'quiz',
      title: quiz?.title || selectedTest?.title || 'Practice Quiz',
      data: { quiz, run: { answers: a, grades, tookMs } },
      score: `${score.points}/${score.total}`,
    });
  };
  const resetQuiz = () => {
    setQuiz(null); setSavedRun(null); setSelectedTest(null);
    setAnswers({}); setWrittenAnswers({}); setQuizResults(null);
  };



  const field = 'mt-1.5 h-11 w-full rounded-lg border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground';
  const label = 'text-sm font-medium text-foreground';
  const primaryBtn = 'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50';
  const card = 'rounded-2xl border bg-card p-5';
  const choosing = !quiz && !isGeneratingQuiz && !selectedTest;

  /** Difficulty, length, time limit and written answers: set once, used by whichever quiz is made. */
  const quizSettings = (
    <fieldset className={card}>
      <legend className="sr-only">How the quiz is made</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="q-diff" className={label}>Difficulty</label>
          <select id="q-diff" value={difficulty} onChange={e => setDifficulty(e.target.value)} className={field}>
            {DIFFICULTIES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="q-len" className={label}>Questions</label>
          <select id="q-len" value={quizCount} onChange={e => setQuizCount(Number(e.target.value))} className={field}>
            {QUIZ_LENGTHS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="q-time" className={label}>Time limit</label>
          <select id="q-time" value={timeLimit} onChange={e => setTimeLimit(Number(e.target.value))} className={field}>
            {TIME_LIMITS.map(t => <option key={t} value={t}>{t ? `${t} minutes` : 'No limit'}</option>)}
          </select>
        </div>
      </div>
      <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-foreground">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={includeWritten} onChange={e => setIncludeWritten(e.target.checked)} />
        Include written answers (worked solutions, marked by the AI)
      </label>
    </fieldset>
  );

  const history = (
    <StudyHistorySidebar
      history={studyHistory.filter(h => h.type !== 'flashcards' && h.type !== 'companion')}
      activeType={activeTab === 'grading' ? 'grading' : activeTab === 'quiz' ? 'quiz' : 'all'}
      isLoading={historyLoading}
      onSelectItem={(item) => {
        if (item.type === 'grading') {
          setActiveTab('grading');
          setGradingResult(item.data?.result);
          setHomeworkTitle(item.title);
        } else if (item.type === 'quiz') {
          setActiveTab('quiz');
          const q = normaliseQuiz(item.data?.quiz);
          let run = item.data?.run;
          if (!run) {   // saved before the quiz was rebuilt: answers and written grades kept separately
            const a = { ...(item.data?.answers || {}) };
            Object.entries(item.data?.writtenAnswers || {}).forEach(([i, v]) => { a[`w${i}`] = v; });
            const grades = {};
            (item.data?.results?.results || []).forEach((r, i) => {
              if (r?.type === 'written' && r.graded) grades[i] = { score: Number(r.writtenScore) || 0, verdict: r.writtenScore >= 9 ? 'correct' : r.writtenScore >= 4 ? 'partly correct' : 'incorrect', what_was_right: r.feedback || '', what_was_missing: '', missing_points: r.missingPoints || [] };
            });
            run = { answers: a, grades };
          }
          setSelectedTest(null);
          setQuiz({ ...q, title: item.title });
          setSavedRun(run);
          setRunKey(k => k + 1);
        }
      }}
      onDeleteItem={(id) => deleteHistoryMutation.mutate(id)}
    />
  );

  /**
   * Practice. One page, three tools (quiz, flashcards, homework feedback), with
   * past attempts beside them on a wide screen and under them on a phone. The
   * quickest path is first: a test that is coming up is one press away.
   */
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Practice</h1>
        <p className="mt-2 text-base text-muted-foreground sm:text-lg">Quiz yourself, run flashcards, or get feedback on homework.</p>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-5 grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-secondary/60 p-1 sm:inline-grid sm:w-auto">
              {[['quiz', Target, 'Quiz', 'Quiz'], ['cards', Layers, 'Flashcards', 'Cards'], ['grading', Upload, 'Homework feedback', 'Feedback']].map(([id, Icon, name, short]) => (
                <TabsTrigger key={id} value={id}
                  aria-label={name} className="h-11 gap-2 rounded-lg px-2 text-sm sm:px-4 font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                  <Icon className="h-4 w-4 flex-none" aria-hidden="true" /><span className="hidden sm:inline">{name}</span><span className="sm:hidden">{short}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="cards" className="mt-0">
              <Flashcards initial={location.state?.tab === 'cards' || location.state?.className ? location.state : null} />
            </TabsContent>

            <TabsContent value="quiz" className="mt-0 space-y-5">
              {choosing && (
                <>
                  {tests.length > 0 && (
                    <section aria-labelledby="test-quiz-h" className="overflow-hidden rounded-2xl border bg-card">
                      <h2 id="test-quiz-h" className="px-5 pb-1 pt-4 text-lg font-semibold tracking-tight text-foreground">Practise for a test</h2>
                      <ul className="divide-y divide-border/60">
                        {tests.map(test => {
                          const n = daysUntil(parseDay(test.date));
                          return (
                            <li key={test.id}>
                              <button type="button" onClick={() => setSelectedTest(test)}
                                className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left hover:bg-accent/30">
                                <span className={cn('grid h-11 w-11 flex-none place-items-center rounded-xl text-center leading-none',
                                  n <= 2 ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-secondary text-foreground')} aria-hidden="true">
                                  <span><span className="block text-base font-bold tabular-nums">{n}</span><span className="block text-[11px] font-medium">{n === 1 ? 'day' : 'days'}</span></span>
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-base font-medium text-foreground">{test.title}</span>
                                  <span className="block truncate text-[13px] text-muted-foreground">{[test.class_name, relativeDay(test.date)].filter(Boolean).join(' · ')}</span>
                                </span>
                                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  <div className="grid gap-5 lg:grid-cols-2">
                    <section className={card} aria-labelledby="topic-quiz-h">
                      <h2 id="topic-quiz-h" className="text-lg font-semibold tracking-tight text-foreground">Quiz on any topic</h2>
                      <div className="mt-3 space-y-4">
                        <div>
                          <label htmlFor="study-f4" className={label}>Topic</label>
                          <input id="study-f4" value={customQuizTopic} onChange={(e) => setCustomQuizTopic(e.target.value)}
                            placeholder="Photosynthesis, World War II, quadratics" className={field} />
                        </div>
                        <div>
                          <label htmlFor="study-f5" className={label}>Subject or class <span className="font-normal text-muted-foreground">(optional)</span></label>
                          <input id="study-f5" value={customQuizClass} onChange={(e) => setCustomQuizClass(e.target.value)}
                            placeholder="Biology" className={field} />
                        </div>
                        <button type="button" onClick={() => handleGenerateQuiz(null, lectureNotes.slice(0, 12000), [], includeWritten)}
                          disabled={!customQuizTopic.trim()} className={primaryBtn}>
                          <Brain className="h-5 w-5" aria-hidden="true" />Make the quiz
                        </button>
                      </div>
                    </section>

                    <section className={card} aria-labelledby="class-quiz-h">
                      <h2 id="class-quiz-h" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"><GraduationCap className="h-5 w-5 text-muted-foreground" aria-hidden="true" />Quiz on a whole class</h2>
                      <p className="mt-1 text-sm text-muted-foreground">From its lecture notes and anything you added to it.</p>
                      {classOptions.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">Nothing to quiz from yet. Record a lecture, or add material to a class, and it appears here.</p>
                      ) : (
                        <div className="mt-3 space-y-4">
                          <div>
                            <label htmlFor="quiz-class" className={label}>Class</label>
                            <select id="quiz-class" value={quizClass} onChange={e => { setQuizClass(e.target.value); setLeftOut(new Set()); }} className={field}>
                              <option value="">Choose a class…</option>
                              {classOptions.map(c => <option key={c.id} value={c.name}>{c.name} · {classSources(lectures, c.name).length} item{classSources(lectures, c.name).length === 1 ? '' : 's'}</option>)}
                            </select>
                          </div>
                          {quizClass && (
                            <>
                              <fieldset>
                                <legend className={label}>Include</legend>
                                <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
                                  {sourcesForClass.map(x => (
                                    <li key={x.id}>
                                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-secondary">
                                        <input type="checkbox" className="h-5 w-5 accent-primary" checked={!leftOut.has(x.id)}
                                          onChange={e => setLeftOut(prev => { const n = new Set(prev); if (e.target.checked) n.delete(x.id); else n.add(x.id); return n; })} />
                                        {x.kind === 'material' ? <FileText className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" /> : <NotebookPen className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />}
                                        <span className="min-w-0 flex-1 truncate text-foreground">{x.title}</span>
                                        <span className="flex-none text-xs text-muted-foreground">{x.kind === 'material' ? 'material' : x.date}</span>
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                              </fieldset>
                              <div>
                                <label htmlFor="quiz-focus" className={label}>Focus on <span className="font-normal text-muted-foreground">(optional)</span></label>
                                <input id="quiz-focus" value={quizFocus} onChange={e => setQuizFocus(e.target.value)} placeholder="cell division" className={field} />
                              </div>
                            </>
                          )}
                          <button type="button" onClick={handleClassQuiz} disabled={!quizClass || !chosenSources.length} className={primaryBtn}>
                            <Brain className="h-5 w-5" aria-hidden="true" />{quizClass ? `Quiz me on ${chosenSources.length} item${chosenSources.length === 1 ? '' : 's'}` : 'Make the quiz'}
                          </button>
                        </div>
                      )}
                    </section>
                  </div>

                  {quizSettings}
                </>
              )}

              {selectedTest && !quiz && !isGeneratingQuiz && (
                <section className={cn(card, 'space-y-4')} aria-labelledby="sel-test-h">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setSelectedTest(null)} aria-label="Back to all quizzes"
                      className="-ml-2 grid h-11 w-11 flex-none place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
                      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <h2 id="sel-test-h" className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-foreground">{selectedTest.title}</h2>
                  </div>
                  <div>
                    <label htmlFor="study-f6" className={label}>What it covers <span className="font-normal text-muted-foreground">(optional)</span></label>
                    <textarea id="study-f6" value={quizDescription} onChange={(e) => setQuizDescription(e.target.value)} rows={3}
                      placeholder="Chapters 4 and 5, cell division, the lab on osmosis" className={cn(field, 'h-auto py-2')} />
                  </div>
                  <div>
                    <label htmlFor="study-f7" className={label}>Study material <span className="font-normal text-muted-foreground">(optional, photos or PDFs)</span></label>
                    <input id="study-f7" type="file" multiple accept="image/*,.pdf" onChange={(e) => setQuizFiles(Array.from(e.target.files))}
                      className="mt-1.5 block w-full text-sm text-foreground file:mr-3 file:h-11 file:rounded-lg file:border file:border-border file:bg-secondary file:px-4 file:text-sm file:font-medium file:text-foreground" />
                    {quizFiles.length > 0 && <p className="mt-1 text-sm text-muted-foreground" role="status">{quizFiles.length} file{quizFiles.length === 1 ? '' : 's'} chosen</p>}
                  </div>
                  <button type="button" onClick={() => handleGenerateQuiz(selectedTest, quizDescription, quizFiles, includeWritten)} className={primaryBtn}>
                    <Brain className="h-5 w-5" aria-hidden="true" />Make the quiz
                  </button>
                </section>
              )}
              {selectedTest && !quiz && !isGeneratingQuiz && quizSettings}

              {isGeneratingQuiz && (
                <div className={cn(card, 'flex items-center gap-3 py-10 text-base text-foreground')} role="status">
                  <Loader2 className="h-6 w-6 flex-none animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
                  {makingStep || 'Writing your quiz. This takes a few seconds.'}
                </div>
              )}

              {quiz && !isGeneratingQuiz && (
                <QuizRunner key={runKey} quiz={quiz} timeLimit={savedRun ? 0 : timeLimit} saved={savedRun}
                  onSubmitted={saveAttempt}
                  onNew={resetQuiz}
                  onRetake={() => { setSavedRun(null); setRunKey(k => k + 1); }}
                  onRegenerate={() => (lastMake.current ? lastMake.current() : resetQuiz())} />
              )}

              <AiNote>Questions and marking are written by AI and can be wrong. If an answer looks off, check it against your notes or textbook.</AiNote>
            </TabsContent>

            <TabsContent value="grading" className="mt-0 space-y-5">
              <section className={cn(card, 'space-y-4')} aria-labelledby="grade-h">
                <h2 id="grade-h" className="text-lg font-semibold tracking-tight text-foreground">Feedback on your homework</h2>
                <div>
                  <label htmlFor="homework-title" className={label}>What is the assignment?</label>
                  <input id="homework-title" value={homeworkTitle} onChange={(e) => setHomeworkTitle(e.target.value)}
                    placeholder="Chapter 5 problems 1 to 12" className={field} />
                </div>
                <div role="radiogroup" aria-label="How to give your work" className="inline-flex rounded-lg bg-secondary/60 p-0.5">
                  {[[false, 'Upload a photo or PDF'], [true, 'Paste text']].map(([v, name]) => (
                    <button key={name} type="button" role="radio" aria-checked={useTextInput === v} onClick={() => setUseTextInput(v)}
                      className={cn('h-10 rounded-md px-3 text-sm font-medium', useTextInput === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{name}</button>
                  ))}
                </div>
                {!useTextInput ? (
                  <div>
                    <label htmlFor="homework-file" className={label}>Your work</label>
                    <input id="homework-file" type="file" onChange={handleFileUpload} accept="image/*,.pdf"
                      className="mt-1.5 block w-full text-sm text-foreground file:mr-3 file:h-11 file:rounded-lg file:border file:border-border file:bg-secondary file:px-4 file:text-sm file:font-medium file:text-foreground" />
                    {selectedFile && <p className="mt-1 text-sm text-muted-foreground" role="status">Chosen: {selectedFile.name}</p>}
                  </div>
                ) : (
                  <div>
                    <label htmlFor="pasted-work" className={label}>Your work</label>
                    <textarea id="pasted-work" value={pastedWork} onChange={(e) => setPastedWork(e.target.value)} rows={10}
                      placeholder="Paste your answers here" className={cn(field, 'h-auto py-2')} />
                  </div>
                )}
                <button type="button" onClick={handleGradeHomework}
                  disabled={(useTextInput ? !pastedWork : !selectedFile) || !homeworkTitle || isGrading} className={primaryBtn}>
                  {isGrading
                    ? <><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Reading your work…</>
                    : <><Sparkles className="h-5 w-5" aria-hidden="true" />Get feedback</>}
                </button>
              </section>
              <div aria-live="polite">
                {gradingResult && (
                  <section className={card} aria-labelledby="grade-result-h">
                    <h2 id="grade-result-h" className="mb-2 text-lg font-semibold tracking-tight text-foreground">Feedback</h2>
                    <RichText text={gradingResult} />
                  </section>
                )}
              </div>
              <AiNote>This feedback and grade are written by AI. They are a second opinion, not your teacher’s mark.</AiNote>
            </TabsContent>
          </Tabs>
        </div>

        <aside aria-label="Past quizzes and feedback" className="min-w-0">{history}</aside>
      </div>
    </div>
  );
}

/** Said plainly wherever the AI writes something a student might rely on. */
function AiNote({ children }) {
  return (
    <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />{children}
    </p>
  );
}

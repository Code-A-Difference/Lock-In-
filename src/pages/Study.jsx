import { db } from '@/api/db';
import RichText from '@/components/lockin/RichText';

import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Upload, Target, Sparkles, Loader2, GraduationCap, FileText, NotebookPen } from "lucide-react";
import { classSources, gatherMaterial, classQuizPrompt } from '@/lib/classQuiz';
import { DIFFICULTIES, QUIZ_LENGTHS, TIME_LIMITS, QUIZ_SCHEMA, quizRules, normaliseQuiz, writtenCount, checkPrompt, CHECK_SCHEMA, applyChecks } from '@/lib/quizKit';
import QuizRunner from '@/components/study/QuizRunner';
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { useStudyData } from '@/lib/data';
import { parseDay, daysUntil } from '@/lib/dates';
import StudyHistorySidebar from "../components/study/StudyHistorySidebar";

// The AI Assistant chat and the Planner tab moved out of here: the planner
// is inline on the Today page now, and asking Lock In a question works by
// voice from anywhere (FocusContext.handleVoice), not as a typed chat.
export default function Study() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(['quiz', 'grading'].includes(location.state?.tab) ? location.state.tab : 'quiz');

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
      const raw = await db.integrations.Core.InvokeLLM({ prompt: checkPrompt(questions), response_json_schema: CHECK_SCHEMA, maxTokens: 1500 });
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
  const [showHistory, setShowHistory] = useState(true);
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

  const upcomingTest = tests[0];

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
        response = await db.integrations.Core.InvokeLLM({ prompt });
        setGradingResult(response);
      } else if (selectedFile) {
        const { file_url } = await db.integrations.Core.UploadFile({ file: selectedFile });
        response = await db.integrations.Core.InvokeLLM({
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
      const response = await db.integrations.Core.InvokeLLM({
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
      alert(`Couldn't make that quiz: ${error?.message || 'please try again.'}`);
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
      
      const response = await db.integrations.Core.InvokeLLM({
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
      alert(`Couldn't make that quiz: ${error?.message || 'please try again.'}`);
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



  /** Difficulty, length, time limit and written answers, the same for every kind of quiz. */
  const quizSettings = (idp) => (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${idp}-diff`}>Difficulty</Label>
        <select id={`${idp}-diff`} value={difficulty} onChange={e => setDifficulty(e.target.value)} className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base text-foreground sm:text-sm">
          {DIFFICULTIES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`${idp}-len`}>Questions</Label>
        <select id={`${idp}-len`} value={quizCount} onChange={e => setQuizCount(Number(e.target.value))} className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base text-foreground sm:text-sm">
          {QUIZ_LENGTHS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`${idp}-time`}>Time limit</Label>
        <select id={`${idp}-time`} value={timeLimit} onChange={e => setTimeLimit(Number(e.target.value))} className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base text-foreground sm:text-sm">
          {TIME_LIMITS.map(t => <option key={t} value={t}>{t ? `${t} minutes` : 'No limit'}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-3">
        <input type="checkbox" className="h-4 w-4" checked={includeWritten} onChange={e => setIncludeWritten(e.target.checked)} />
        Include written answers (worked solutions, marked by the AI)
      </label>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div>
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Brain className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Practice</h1>
            <p className="text-sm text-muted-foreground">Create quizzes and get feedback on homework. Ask Lock In questions by voice anywhere in the app.</p>
          </div>
        </div>

        {upcomingTest && activeTab === "quiz" && (
          <Card className="mb-6 border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-purple-900 dark:text-purple-300">Upcoming Test Alert</p>
                  <p className="text-sm text-purple-700 dark:text-purple-400 mt-1">
                    You have <strong>{upcomingTest.title}</strong>{upcomingTest.class_name ? ` (${upcomingTest.class_name})` : ''} on {format(parseDay(upcomingTest.date), 'MMMM d')}. 
                    Want to practice with an AI-generated quiz?
                  </p>
                  <Button 
                    size="sm" 
                    className="mt-3 bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800"
                    onClick={() => setSelectedTest(upcomingTest)}
                  >
                    Practise for it
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 grid h-12 w-full grid-cols-2 sm:mb-6 dark:bg-slate-800 dark:border-slate-700">
            <TabsTrigger value="grading" className="h-10 dark:text-slate-300 dark:data-[state=active]:bg-purple-600 dark:data-[state=active]:text-white">
              <Upload className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Grade HW</span>
              <span className="sm:hidden">Grade</span>
            </TabsTrigger>
            <TabsTrigger value="quiz" className="h-10 dark:text-slate-300 dark:data-[state=active]:bg-indigo-600 dark:data-[state=active]:text-white">
              <Target className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Quiz</span>
              <span className="sm:hidden">Quiz</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="grading">
            <Card className="border-0 shadow-none sm:border-2 sm:shadow-sm border-purple-100 dark:border-purple-900">
              <CardHeader className="hidden sm:flex bg-card">
                <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                  <Upload className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  AI Homework Grading
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">Get instant feedback on your work</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 px-0 pt-4 sm:px-6 sm:pt-6">
                <div className="space-y-2">
                  <Label htmlFor="homework-title" className="text-base font-semibold text-slate-700 dark:text-slate-300">Assignment Title</Label>
                  <Input
                    id="homework-title"
                    value={homeworkTitle}
                    onChange={(e) => setHomeworkTitle(e.target.value)}
                    placeholder="e.g., Chapter 5 Math Problems"
                    className="text-lg dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  />
                </div>
                
                <div className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <Button
                    variant={useTextInput ? "outline" : "default"}
                    size="sm"
                    onClick={() => setUseTextInput(false)}
                  >
                    Upload File
                  </Button>
                  <Button
                    variant={useTextInput ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUseTextInput(true)}
                  >
                    Paste Text
                  </Button>
                </div>

                {!useTextInput ? (
                  <div className="space-y-2">
                    <Label htmlFor="homework-file" className="text-base font-semibold text-slate-700 dark:text-slate-300">Upload Your Work</Label>
                    <div className="border-2 border-dashed border-purple-200 dark:border-purple-800 rounded-lg p-6 text-center hover:border-purple-400 transition-colors">
                      <Upload className="w-8 h-8 mx-auto mb-2 text-purple-400 dark:text-purple-300" />
                      <Input
                        id="homework-file"
                        type="file"
                        onChange={handleFileUpload}
                        accept="image/*,.pdf"
                        className="max-w-xs mx-auto dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                      />
                      {selectedFile && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
                          ✓ {selectedFile.name}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="pasted-work" className="text-base font-semibold text-slate-700 dark:text-slate-300">Paste Your Work</Label>
                    <Textarea
                      id="pasted-work"
                      value={pastedWork}
                      onChange={(e) => setPastedWork(e.target.value)}
                      placeholder="Paste your homework answers here..."
                      rows={10}
                      className="font-mono text-sm dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                    />
                  </div>
                )}
                
                <Button 
                  onClick={handleGradeHomework} 
                  disabled={(useTextInput ? !pastedWork : !selectedFile) || !homeworkTitle || isGrading}
                  className="w-full text-lg py-6"
                >
                  {isGrading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Grading...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 mr-2" />
                      Grade My Homework
                    </>
                  )}
                </Button>
                
                {gradingResult && (
                  <Card className="mt-6 border-2 border-green-200 dark:border-green-800 bg-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2 text-slate-800 dark:text-slate-200">
                        <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
                        Grading Results
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <RichText text={gradingResult} />
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quiz">
            <Card className="border-0 shadow-none sm:border-2 sm:shadow-sm border-indigo-100 dark:border-indigo-900">
              <CardHeader className="hidden sm:flex bg-card">
                <CardTitle className="text-slate-800 dark:text-slate-200">Practice Quizzes</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">Test your knowledge with AI-generated questions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-0 pt-4 sm:px-6 sm:pt-6">
                {!quiz && !isGeneratingQuiz && !selectedTest && (
                  <>
                    <div className="space-y-4">
                      <section className="rounded-lg border bg-card p-4" aria-labelledby="class-quiz-h">
                        <h3 id="class-quiz-h" className="mb-1 flex items-center gap-2 font-medium text-foreground"><GraduationCap className="h-4 w-4" aria-hidden="true" />Quiz me on a whole class</h3>
                        <p className="mb-3 text-sm text-muted-foreground">Every lecture's notes for the class, plus anything you've added to it, handouts, slides, photos, pasted notes.</p>
                        {classOptions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Record a lecture or add material to a class in Notes, and it can be quizzed here.</p>
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <Label htmlFor="quiz-class">Class</Label>
                              <select id="quiz-class" value={quizClass} onChange={e => { setQuizClass(e.target.value); setLeftOut(new Set()); }}
                                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base text-foreground sm:text-sm">
                                <option value="">Choose a class…</option>
                                {classOptions.map(c => <option key={c.id} value={c.name}>{c.name} · {classSources(lectures, c.name).length} item{classSources(lectures, c.name).length === 1 ? '' : 's'}</option>)}
                              </select>
                            </div>
                            {quizClass && (
                              <>
                                <fieldset>
                                  <legend className="text-sm font-medium text-foreground">Include</legend>
                                  <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                                    {sourcesForClass.map(x => (
                                      <li key={x.id}>
                                        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-secondary">
                                          <input type="checkbox" className="h-4 w-4" checked={!leftOut.has(x.id)}
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
                                  <Label htmlFor="quiz-focus">Focus on (optional)</Label>
                                  <Input id="quiz-focus" value={quizFocus} onChange={e => setQuizFocus(e.target.value)} placeholder="e.g. cell division" className="mt-1" />
                                </div>
                                {quizSettings('cq')}
                                <Button onClick={handleClassQuiz} disabled={!chosenSources.length} className="w-full">
                                  <Brain className="mr-2 h-4 w-4" />Quiz me on {chosenSources.length} item{chosenSources.length === 1 ? '' : 's'}
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </section>

                      <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                        <h3 className="font-medium text-slate-800 dark:text-slate-200 mb-3">Create Custom Quiz</h3>
                        <div className="space-y-3">
                          <div>
                            <Label className="text-slate-700 dark:text-slate-300">Topic</Label>
                            <Input
                              value={customQuizTopic}
                              onChange={(e) => setCustomQuizTopic(e.target.value)}
                              placeholder="e.g., World War II, Photosynthesis, Algebra"
                              className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                            />
                          </div>
                          <div>
                            <Label className="text-slate-700 dark:text-slate-300">Subject/Class (optional)</Label>
                            <Input
                              value={customQuizClass}
                              onChange={(e) => setCustomQuizClass(e.target.value)}
                              placeholder="e.g., History, Biology, Math"
                              className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                            />
                          </div>
                          {quizSettings('cu')}
                          <Button 
                            onClick={() => handleGenerateQuiz(null, lectureNotes.slice(0, 12000), [], includeWritten)}
                            disabled={!customQuizTopic.trim()}
                            className="w-full bg-indigo-600 hover:bg-indigo-700"
                          >
                            Generate Quiz
                          </Button>
                        </div>
                      </div>

                      {tests.length > 0 && (
                        <>
                          <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                              <span className="w-full border-t dark:border-slate-700" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                              <span className="bg-white dark:bg-slate-800 px-2 text-slate-500 dark:text-slate-400">Or select from upcoming tests</span>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            {tests.map(test => (
                              <Card key={test.id} className="hover:border-indigo-300 transition-colors cursor-pointer dark:bg-slate-800 dark:border-slate-700 dark:hover:border-indigo-600" onClick={() => setSelectedTest(test)}>
                                <CardContent className="pt-4">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="font-medium text-slate-800 dark:text-slate-200">{test.title}</p>
                                      <p className="text-sm text-slate-500 dark:text-slate-400">{test.class_name} • {format(new Date(test.date + 'T00:00:00'), 'MMM d')}</p>
                                    </div>
                                    <Button size="sm" className="dark:bg-indigo-600 dark:hover:bg-indigo-700">Select</Button>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
                
                {selectedTest && !quiz && !isGeneratingQuiz && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-200">{selectedTest.title}</h3>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedTest(null)} className="dark:text-slate-300 dark:hover:bg-slate-700">
                        Change
                      </Button>
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-slate-700 dark:text-slate-300">Add Description (optional)</Label>
                      <Textarea
                        value={quizDescription}
                        onChange={(e) => setQuizDescription(e.target.value)}
                        placeholder="Describe what topics will be covered..."
                        rows={3}
                        className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-slate-700 dark:text-slate-300">Upload Study Materials (optional)</Label>
                      <Input
                        type="file"
                        multiple
                        accept="image/*,.pdf"
                        onChange={(e) => setQuizFiles(Array.from(e.target.files))}
                        className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                      />
                      {quizFiles.length > 0 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">{quizFiles.length} file(s) selected</p>
                      )}
                    </div>
                    
                    {quizSettings('tq')}
                    
                    <Button 
                      onClick={() => handleGenerateQuiz(selectedTest, quizDescription, quizFiles, includeWritten)}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800"
                    >
                      Generate Quiz
                    </Button>
                  </div>
                )}
                
                {isGeneratingQuiz && (
                  <div className="text-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
                    <p className="text-slate-600 dark:text-slate-400">{makingStep || 'Writing your quiz…'}</p>
                  </div>
                )}
                
                {quiz && !isGeneratingQuiz && (
                  <QuizRunner key={runKey} quiz={quiz} timeLimit={savedRun ? 0 : timeLimit} saved={savedRun}
                    onSubmitted={saveAttempt}
                    onNew={resetQuiz}
                    onRetake={() => { setSavedRun(null); setRunKey(k => k + 1); }}
                    onRegenerate={() => (lastMake.current ? lastMake.current() : resetQuiz())} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
          </div>
          
          <div className="hidden lg:block">
            <StudyHistorySidebar
              history={studyHistory}
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
          </div>
        </div>
      </div>
    </div>
  );
}

const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Upload, MessageSquare, Target, Sparkles, Loader2, Mic, Volume2, VolumeX, Paperclip, X, History, Plus, CalendarClock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from 'react-markdown';
import { format, isFuture, addDays } from "date-fns";
import StudyHistorySidebar from "../components/study/StudyHistorySidebar";
import SmartPlanner from "../components/study/SmartPlanner";

export default function Study() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("assistant");
  const [plannerKey, setPlannerKey] = useState(0);
  
  // AI Assistant state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [chatFiles, setChatFiles] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
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
  const [answers, setAnswers] = useState({});
  const [writtenAnswers, setWrittenAnswers] = useState({});
  const [quizResults, setQuizResults] = useState(null);
  const [quizDescription, setQuizDescription] = useState('');
  const [quizFiles, setQuizFiles] = useState([]);
  const [customQuizTopic, setCustomQuizTopic] = useState('');
  const [customQuizClass, setCustomQuizClass] = useState('');
  const [includeWritten, setIncludeWritten] = useState(false);
  const [isGradingWritten, setIsGradingWritten] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [showHistory, setShowHistory] = useState(true);

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

  const updateHistoryMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.StudyHistory.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studyHistory'] })
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: (id) => db.entities.StudyHistory.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studyHistory'] })
  });

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

  const { data: allClasses = [] } = useQuery({
    queryKey: ['classes'],
    queryFn: () => db.entities.Class.list()
  });

  const classes = allClasses.filter(c => 
    c.members?.includes(user?.email)
  );

  const { data: allTests = [] } = useQuery({
    queryKey: ['tests'],
    queryFn: () => db.entities.Test.list('-date')
  });

  const tests = allTests.filter(test => 
    classes.some(c => c.name === test.class_name) && isFuture(new Date(test.date))
  );

  const { data: allHomework = [] } = useQuery({
    queryKey: ['homework'],
    queryFn: () => db.entities.Homework.list('-due_date')
  });

  const homework = allHomework.filter(hw => 
    classes.some(c => c.name === hw.class_name)
  );

  const upcomingTest = tests[0];

  // AI Assistant
  const handleSendMessage = async () => {
    if (!input.trim() && chatFiles.length === 0) return;
    
    const userMessage = { role: 'user', content: input || '[Uploaded files]' };
    setMessages([...messages, userMessage]);
    const currentInput = input;
    const currentFiles = [...chatFiles];
    setInput('');
    setChatFiles([]);
    setIsThinking(true);

    try {
      let fileUrls = [];
      for (let file of currentFiles) {
        const { file_url } = await db.integrations.Core.UploadFile({ file });
        fileUrls.push(file_url);
      }

      const testsContext = tests.length > 0 
        ? `Upcoming tests: ${tests.map(t => `${t.title} (${t.class_name}) on ${format(new Date(t.date), 'MMM d')}`).join(', ')}` 
        : '';
      
      const response = await db.integrations.Core.InvokeLLM({
        prompt: `You are a helpful, friendly AI assistant. ${testsContext ? testsContext + '. ' : ''}Answer any questions the student has - whether about studying, homework, tests, or anything else they're curious about. Be conversational, helpful, and concise.\n\nStudent: ${currentInput}`,
        add_context_from_internet: true,
        file_urls: fileUrls.length > 0 ? fileUrls : undefined
      });
      
      const newMessages = [...messages, userMessage, { role: 'assistant', content: response }];
      setMessages(newMessages);
      
      // Save or update conversation history
      if (currentConversationId) {
        updateHistoryMutation.mutate({
          id: currentConversationId,
          data: { data: { messages: newMessages } }
        });
      } else {
        const saved = await db.entities.StudyHistory.create({
          type: 'conversation',
          title: currentInput.slice(0, 50) + (currentInput.length > 50 ? '...' : ''),
          data: { messages: newMessages }
        });
        setCurrentConversationId(saved.id);
        queryClient.invalidateQueries({ queryKey: ['studyHistory'] });
      }
      
      // Text-to-speech
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(response);
        utterance.rate = 1.1;
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setIsThinking(false);
    }
  };

  const stopSpeaking = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + ' ' + transcript);
    };

    recognition.start();
  };

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
      setGradingResult('Error grading homework. Please try again.');
    } finally {
      setIsGrading(false);
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
      
      const questionTypes = useWritten 
        ? 'Create 3 multiple choice questions AND 2 open-ended/written questions' 
        : 'Create 5 multiple choice questions';
      
      const response = await db.integrations.Core.InvokeLLM({
        prompt: `Generate a practice quiz for: "${title}" ${className ? `in ${className}` : ''}.
        ${description ? `Topics/Description: ${description}` : ''}
        
${questionTypes} that would help a student prepare. 

For multiple choice questions, include:
- The correct answer index
- An explanation of why the correct answer is right
- An explanation of why each wrong answer is incorrect

For open-ended questions (if included), provide:
- A sample ideal answer
- Key points that should be mentioned

Return ONLY valid JSON in this exact format:
{
  "questions": [
    {
      "type": "multiple_choice",
      "question": "Question text here?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correct": 0,
      "explanation": "Why this answer is correct",
      "wrong_explanations": ["Why A is wrong (if not correct)", "Why B is wrong (if not correct)", "Why C is wrong (if not correct)", "Why D is wrong (if not correct)"]
    },
    {
      "type": "written",
      "question": "Open-ended question here?",
      "ideal_answer": "Sample ideal answer",
      "key_points": ["Point 1", "Point 2", "Point 3"]
    }
  ]
}`,
        file_urls: fileUrls.length > 0 ? fileUrls : undefined,
        response_json_schema: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  question: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correct: { type: "number" },
                  explanation: { type: "string" },
                  wrong_explanations: { type: "array", items: { type: "string" } },
                  ideal_answer: { type: "string" },
                  key_points: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });
      
      setQuiz(response);
      setQuizDescription('');
      setQuizFiles([]);
      setCustomQuizTopic('');
      setCustomQuizClass('');
    } catch (error) {
      alert('Error generating quiz. Please try again.');
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleSubmitQuiz = async () => {
    const mcQuestions = quiz.questions.filter(q => q.type === 'multiple_choice' || !q.type);
    const writtenQuestions = quiz.questions.filter(q => q.type === 'written');
    
    let score = 0;
    const results = [];
    
    // Grade multiple choice
    quiz.questions.forEach((q, idx) => {
      if (q.type === 'multiple_choice' || !q.type) {
        const isCorrect = answers[idx] === q.correct;
        if (isCorrect) score++;
        const selectedAnswer = answers[idx];
        const wrongExplanation = !isCorrect && q.wrong_explanations ? q.wrong_explanations[selectedAnswer] : null;
        results.push({ 
          type: 'multiple_choice',
          isCorrect, 
          explanation: q.explanation,
          wrongExplanation,
          selectedAnswer,
          correctAnswer: q.correct
        });
      } else if (q.type === 'written') {
        results.push({
          type: 'written',
          userAnswer: writtenAnswers[idx] || '',
          idealAnswer: q.ideal_answer,
          keyPoints: q.key_points,
          graded: false
        });
      }
    });

    // Grade written questions with AI
    if (writtenQuestions.length > 0) {
      setIsGradingWritten(true);
      for (let i = 0; i < quiz.questions.length; i++) {
        const q = quiz.questions[i];
        if (q.type === 'written' && writtenAnswers[i]) {
          try {
            const gradeResponse = await db.integrations.Core.InvokeLLM({
              prompt: `Grade this student's answer:
Question: ${q.question}
Student's Answer: ${writtenAnswers[i]}
Ideal Answer: ${q.ideal_answer}
Key Points to look for: ${q.key_points.join(', ')}

Provide a score out of 10 and brief feedback.`,
              response_json_schema: {
                type: "object",
                properties: {
                  score: { type: "number" },
                  feedback: { type: "string" },
                  missing_points: { type: "array", items: { type: "string" } }
                }
              }
            });
            
            const resultIdx = results.findIndex((r, ri) => r.type === 'written' && ri === i);
            if (resultIdx !== -1) {
              results[resultIdx] = {
                ...results[resultIdx],
                graded: true,
                writtenScore: gradeResponse.score,
                feedback: gradeResponse.feedback,
                missingPoints: gradeResponse.missing_points
              };
              if (gradeResponse.score >= 7) score++;
            }
          } catch (e) {
            console.error('Error grading written answer:', e);
          }
        }
      }
      setIsGradingWritten(false);
    }
    
    const quizResultsData = { score, total: quiz.questions.length, results };
    setQuizResults(quizResultsData);
    
    // Save quiz history
    const title = selectedTest?.title || customQuizTopic || 'Practice Quiz';
    saveHistoryMutation.mutate({
      type: 'quiz',
      title: title,
      data: { quiz, results: quizResultsData, answers, writtenAnswers },
      score: `${score}/${quiz.questions.length}`
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 p-4 pb-24 md:pb-4">
      <div className="max-w-5xl mx-auto pt-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">AI Study Assistant</h1>
            <p className="text-slate-500 dark:text-slate-400">Get help, grade homework, and practice with quizzes</p>
          </div>
        </div>

        {upcomingTest && activeTab === "assistant" && messages.length === 0 && (
          <Card className="mb-6 border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-purple-900 dark:text-purple-300">Upcoming Test Alert</p>
                  <p className="text-sm text-purple-700 dark:text-purple-400 mt-1">
                    You have <strong>{upcomingTest.title}</strong> ({upcomingTest.class_name}) on {format(new Date(upcomingTest.date), 'MMMM d')}. 
                    Want to practice with an AI-generated quiz?
                  </p>
                  <Button 
                    size="sm" 
                    className="mt-3 bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800"
                    onClick={() => setActiveTab("quiz")}
                  >
                    Go to Practice Quiz
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-6 dark:bg-slate-800 dark:border-slate-700">
            <TabsTrigger value="assistant" className="dark:text-slate-300 dark:data-[state=active]:bg-indigo-600 dark:data-[state=active]:text-white">
              <MessageSquare className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">AI Assistant</span>
              <span className="sm:hidden">Chat</span>
            </TabsTrigger>
            <TabsTrigger value="planner" className="dark:text-slate-300 dark:data-[state=active]:bg-indigo-600 dark:data-[state=active]:text-white">
              <CalendarClock className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Planner</span>
              <span className="sm:hidden">Plan</span>
            </TabsTrigger>
            <TabsTrigger value="grading" className="dark:text-slate-300 dark:data-[state=active]:bg-purple-600 dark:data-[state=active]:text-white">
              <Upload className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Grade HW</span>
              <span className="sm:hidden">Grade</span>
            </TabsTrigger>
            <TabsTrigger value="quiz" className="dark:text-slate-300 dark:data-[state=active]:bg-indigo-600 dark:data-[state=active]:text-white">
              <Target className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Quiz</span>
              <span className="sm:hidden">Quiz</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assistant">
            <Card className="border-2 border-indigo-100 dark:border-indigo-900">
              <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                      <Brain className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      AI Assistant
                    </CardTitle>
                    <CardDescription className="text-slate-600 dark:text-slate-400">Ask anything - with web access & voice support</CardDescription>
                  </div>
                  {messages.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMessages([]);
                        setCurrentConversationId(null);
                      }}
                      className="dark:border-slate-600"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      New Chat
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="h-96 overflow-y-auto space-y-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600">
                    {messages.length === 0 && (
                      <div className="text-center py-16 text-slate-500 dark:text-slate-400">
                        <Brain className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                        <p>Ask me anything! I have web access for current info.</p>
                      </div>
                    )}
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          msg.role === 'user' 
                            ? 'bg-indigo-500 text-white' 
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600'
                        }`}>
                          <ReactMarkdown className={`text-sm prose prose-sm max-w-none ${msg.role !== 'user' ? 'dark:prose-invert' : ''}`}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ))}
                    {isThinking && (
                      <div className="flex justify-start">
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-4 py-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {chatFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {chatFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1 rounded-lg text-sm">
                          <Paperclip className="w-3 h-3" />
                          <span className="text-slate-700 dark:text-slate-300">{file.name}</span>
                          <button onClick={() => setChatFiles(chatFiles.filter((_, i) => i !== idx))}>
                            <X className="w-3 h-3 text-slate-400 hover:text-slate-600" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => document.getElementById('chat-file-upload').click()}
                        disabled={isThinking}
                      >
                        <Paperclip className="w-4 h-4" />
                      </Button>
                      <input
                        id="chat-file-upload"
                        type="file"
                        multiple
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => setChatFiles([...chatFiles, ...Array.from(e.target.files)])}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={isListening ? null : startListening}
                        disabled={isThinking}
                        className={isListening ? "bg-red-100 text-red-600" : ""}
                      >
                        <Mic className={`w-4 h-4 ${isListening ? 'animate-pulse' : ''}`} />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={isSpeaking ? stopSpeaking : null}
                        disabled={!isSpeaking}
                      >
                        {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </Button>
                    </div>
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask anything..."
                      className="resize-none flex-1 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <Button onClick={handleSendMessage} disabled={isThinking || (!input.trim() && chatFiles.length === 0)} className="dark:bg-indigo-600 dark:hover:bg-indigo-700">
                      Send
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="planner">
            <SmartPlanner
              key={plannerKey}
              homework={homework}
              tests={tests}
              upcomingTest={upcomingTest}
            />
          </TabsContent>

          <TabsContent value="grading">
            <Card className="border-2 border-purple-100 dark:border-purple-900">
              <CardHeader className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20">
                <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                  <Upload className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  AI Homework Grading
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">Get instant feedback on your work</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
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
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-lg py-6"
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
                  <Card className="mt-6 border-2 border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2 text-slate-800 dark:text-slate-200">
                        <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
                        Grading Results
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
                        {gradingResult}
                      </ReactMarkdown>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quiz">
            <Card className="border-2 border-indigo-100 dark:border-indigo-900">
              <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
                <CardTitle className="text-slate-800 dark:text-slate-200">Practice Quizzes</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">Test your knowledge with AI-generated questions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                {!quiz && !isGeneratingQuiz && !selectedTest && (
                  <>
                    <div className="space-y-4">
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
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="include-written"
                              checked={includeWritten}
                              onChange={(e) => setIncludeWritten(e.target.checked)}
                              className="w-4 h-4"
                            />
                            <Label htmlFor="include-written" className="text-slate-700 dark:text-slate-300 cursor-pointer">
                              Include open-ended/written questions
                            </Label>
                          </div>
                          <Button 
                            onClick={() => handleGenerateQuiz(null, '', [], includeWritten)}
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
                    
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="include-written-test"
                        checked={includeWritten}
                        onChange={(e) => setIncludeWritten(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="include-written-test" className="text-slate-700 dark:text-slate-300 cursor-pointer">
                        Include open-ended/written questions
                      </Label>
                    </div>
                    
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
                    <p className="text-slate-600 dark:text-slate-400">Generating your quiz...</p>
                  </div>
                )}
                
                {quiz && !quizResults && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-200">Practice Quiz{selectedTest ? `: ${selectedTest.title}` : ''}</h3>
                      <Badge className="dark:bg-indigo-900 dark:text-indigo-200">{quiz.questions.length} Questions</Badge>
                    </div>
                    
                    {quiz.questions.map((q, idx) => (
                      <Card key={idx} className="dark:bg-slate-800 dark:border-slate-700">
                        <CardContent className="pt-6">
                          <div className="flex items-center gap-2 mb-3">
                            <Badge variant="outline" className="text-xs">
                              {q.type === 'written' ? 'Written' : 'Multiple Choice'}
                            </Badge>
                          </div>
                          <p className="font-medium mb-3 text-slate-800 dark:text-slate-200">{idx + 1}. {q.question}</p>
                          
                          {(q.type === 'multiple_choice' || !q.type) && (
                            <div className="space-y-2">
                              {q.options?.map((option, optIdx) => (
                                <label key={optIdx} className="flex items-center gap-2 p-3 rounded-lg border dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`question-${idx}`}
                                    checked={answers[idx] === optIdx}
                                    onChange={() => setAnswers({...answers, [idx]: optIdx})}
                                    className="w-4 h-4"
                                  />
                                  <span className="text-sm text-slate-700 dark:text-slate-300">{option}</span>
                                </label>
                              ))}
                            </div>
                          )}
                          
                          {q.type === 'written' && (
                            <Textarea
                              value={writtenAnswers[idx] || ''}
                              onChange={(e) => setWrittenAnswers({...writtenAnswers, [idx]: e.target.value})}
                              placeholder="Write your answer here..."
                              rows={4}
                              className="dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                            />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    
                    <Button 
                      onClick={handleSubmitQuiz} 
                      className="w-full dark:bg-indigo-600 dark:hover:bg-indigo-700"
                      disabled={
                        quiz.questions.filter(q => q.type === 'multiple_choice' || !q.type).length !== 
                        Object.keys(answers).length
                      }
                    >
                      Submit Quiz
                    </Button>
                  </div>
                )}
                
                {isGradingWritten && (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
                    <p className="text-slate-600 dark:text-slate-400">Grading written answers...</p>
                  </div>
                )}
                
                {quizResults && !isGradingWritten && (
                  <div className="space-y-4">
                    <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border-indigo-200 dark:border-indigo-800">
                      <CardContent className="pt-6">
                        <div className="text-center">
                          <p className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">
                            {quizResults.score}/{quizResults.total}
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 mt-2">
                            {quizResults.score === quizResults.total ? 'Perfect score! 🎉' :
                             quizResults.score >= quizResults.total * 0.7 ? 'Great job! 👏' :
                             'Keep practicing! 💪'}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                    
                    <div className="space-y-3">
                      <h4 className="font-semibold text-slate-800 dark:text-slate-200">Answer Review:</h4>
                      {quizResults.results.map((result, idx) => (
                        <Card key={idx} className={
                          result.type === 'written' 
                            ? 'border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800'
                            : result.isCorrect 
                              ? 'border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800' 
                              : 'border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800'
                        }>
                          <CardContent className="pt-4 space-y-2">
                            <div className="flex items-start gap-2">
                              <Badge variant={result.type === 'written' ? 'secondary' : result.isCorrect ? 'default' : 'destructive'}>
                                {result.type === 'written' ? '✍️' : result.isCorrect ? '✓' : '✗'} Q{idx + 1}
                              </Badge>
                              <div className="flex-1 space-y-2">
                                {result.type === 'multiple_choice' || !result.type ? (
                                  <>
                                    <p className="text-sm text-slate-700 dark:text-slate-300">
                                      <strong>Correct answer:</strong> {result.explanation}
                                    </p>
                                    {!result.isCorrect && result.wrongExplanation && (
                                      <p className="text-sm text-red-600 dark:text-red-400">
                                        <strong>Why your answer was wrong:</strong> {result.wrongExplanation}
                                      </p>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <p className="text-sm text-slate-700 dark:text-slate-300">
                                      <strong>Your answer:</strong> {result.userAnswer || 'No answer provided'}
                                    </p>
                                    {result.graded && (
                                      <>
                                        <p className="text-sm text-blue-600 dark:text-blue-400">
                                          <strong>Score:</strong> {result.writtenScore}/10
                                        </p>
                                        <p className="text-sm text-slate-700 dark:text-slate-300">
                                          <strong>Feedback:</strong> {result.feedback}
                                        </p>
                                        {result.missingPoints?.length > 0 && (
                                          <p className="text-sm text-amber-600 dark:text-amber-400">
                                            <strong>Missing points:</strong> {result.missingPoints.join(', ')}
                                          </p>
                                        )}
                                      </>
                                    )}
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                      <strong>Ideal answer:</strong> {result.idealAnswer}
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => {
                        setQuiz(null);
                        setAnswers({});
                        setWrittenAnswers({});
                        setQuizResults(null);
                        setSelectedTest(null);
                        setIncludeWritten(false);
                      }} className="flex-1 dark:text-slate-200 dark:hover:bg-slate-700 dark:border-slate-600">
                        New Quiz
                      </Button>
                      <Button onClick={() => {
                        setQuiz(null);
                        setAnswers({});
                        setWrittenAnswers({});
                        setQuizResults(null);
                      }} className="flex-1 dark:bg-indigo-600 dark:hover:bg-indigo-700">
                        Retry Same Topic
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
          </div>
          
          <div className="hidden lg:block">
            <StudyHistorySidebar
              history={studyHistory}
              activeType={activeTab === 'assistant' ? 'conversation' : activeTab === 'grading' ? 'grading' : activeTab === 'quiz' ? 'quiz' : 'all'}
              isLoading={historyLoading}
              onSelectItem={(item) => {
                if (item.type === 'conversation') {
                  setActiveTab('assistant');
                  setMessages(item.data?.messages || []);
                  setCurrentConversationId(item.id);
                } else if (item.type === 'grading') {
                  setActiveTab('grading');
                  setGradingResult(item.data?.result);
                  setHomeworkTitle(item.title);
                } else if (item.type === 'quiz') {
                  setActiveTab('quiz');
                  setQuiz(item.data?.quiz);
                  setQuizResults(item.data?.results);
                  setAnswers(item.data?.answers || {});
                  setWrittenAnswers(item.data?.writtenAnswers || {});
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
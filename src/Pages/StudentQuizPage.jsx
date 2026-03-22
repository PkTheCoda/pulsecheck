import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { db } from "../lib/firebase";

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
        <p className="text-sm text-gray-500">Loading quiz...</p>
      </div>
    </div>
  );
}

function formatTime(secs) {
  if (secs === null || secs < 0) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function StudentQuizPage() {
  const { quizId } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Gate
  const [gateOpen, setGateOpen] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [passwordInput, setPasswordInput] = useState("");

  // Quiz state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [confidence, setConfidence] = useState(3);
  const [questionStartTime, setQuestionStartTime] = useState(Date.now());
  const [answers, setAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Timer
  const [timeLeft, setTimeLeft] = useState(null);
  const [showTimer, setShowTimer] = useState(true);
  const warnedFiveRef = useRef(false);
  const warnedOneRef = useRef(false);
  const autoSubmitCalledRef = useRef(false);

  // Keep latest state accessible in timer callback without stale closure
  const liveRef = useRef({});
  liveRef.current = { answers, selectedIndex, currentQuestion: null, questionStartTime, confidence, result };

  const questions = quiz?.questions || [];
  const currentQuestion = questions[currentQuestionIndex];
  liveRef.current.currentQuestion = currentQuestion;
  const totalQuestions = questions.length;
  const progress = totalQuestions ? ((currentQuestionIndex + 1) / totalQuestions) * 100 : 0;

  useEffect(() => {
    async function loadQuiz() {
      try {
        const snap = await getDoc(doc(db, "quizzes", quizId));
        if (!snap.exists()) { setError("Quiz not found."); return; }
        setQuiz({ id: snap.id, ...snap.data() });
      } catch (e) {
        setError(e.message || "Failed to load quiz.");
      } finally {
        setLoading(false);
      }
    }
    if (quizId) loadQuiz();
  }, [quizId]);

  // Reset per-question state
  useEffect(() => {
    if (!gateOpen) return;
    setQuestionStartTime(Date.now());
    setSelectedIndex(null);
    setConfidence(3);
  }, [currentQuestionIndex, gateOpen]);

  // Start timer when gate opens
  useEffect(() => {
    if (!gateOpen || !quiz?.settings?.timer) return;
    setTimeLeft(quiz.settings.timer * 60);
    warnedFiveRef.current = false;
    warnedOneRef.current = false;
    autoSubmitCalledRef.current = false;
  }, [gateOpen, quiz]);

  // Countdown tick
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0 || result) return;
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, result]);

  // Warnings + auto-submit
  useEffect(() => {
    if (timeLeft === null) return;
    if (timeLeft === 300 && !warnedFiveRef.current) {
      warnedFiveRef.current = true;
      toast("⏰  5 minutes remaining", { duration: 4000, style: { fontWeight: 500 } });
    }
    if (timeLeft === 60 && !warnedOneRef.current) {
      warnedOneRef.current = true;
      toast.error("⚠️  1 minute remaining!", { duration: 5000 });
    }
    if (timeLeft === 0 && !autoSubmitCalledRef.current) {
      autoSubmitCalledRef.current = true;
      const { answers: a, selectedIndex: si, currentQuestion: cq, questionStartTime: qst, confidence: conf } = liveRef.current;
      let finalAnswers = [...a];
      if (si !== null && cq) {
        const timeSpentSeconds = Math.max(1, Math.round((Date.now() - qst) / 1000));
        finalAnswers.push({
          questionId: cq.id,
          chosenIndex: si,
          isCorrect: si === cq.correctAnswerIndex,
          timeSpentSeconds,
          confidence: conf,
        });
      }
      toast.error("Time's up! Submitting your answers.", { duration: 5000 });
      handleSubmit(finalAnswers);
    }
  }, [timeLeft]);

  function openGate() {
    const pwd = quiz?.settings?.password?.trim();
    if (!studentName.trim()) { toast.error("Please enter your name."); return; }
    if (pwd && passwordInput !== pwd) { toast.error("Incorrect password."); return; }
    setQuestionStartTime(Date.now());
    setGateOpen(true);
  }

  function captureCurrentAnswer() {
    const timeSpentSeconds = Math.max(1, Math.round((Date.now() - questionStartTime) / 1000));
    return { questionId: currentQuestion.id, chosenIndex: selectedIndex, isCorrect: selectedIndex === currentQuestion.correctAnswerIndex, timeSpentSeconds, confidence };
  }

  function handleNext() {
    if (selectedIndex === null) { toast.error("Please choose an answer first."); return; }
    const answerPayload = captureCurrentAnswer();
    const nextAnswers = [...answers, answerPayload];
    setAnswers(nextAnswers);
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex((p) => p + 1);
      return;
    }
    handleSubmit(nextAnswers);
  }

  async function handleSubmit(finalAnswers) {
    if (submitting) return;
    try {
      setSubmitting(true);
      const score = finalAnswers.filter((a) => a.isCorrect).length;
      await addDoc(collection(db, "submissions"), {
        quizId,
        ownerId: quiz.ownerId || null,
        studentName: studentName.trim(),
        score,
        isLive: false,
        answers: finalAnswers,
        createdAt: serverTimestamp(),
      });
      setResult({ score, answers: finalAnswers });
      if (!autoSubmitCalledRef.current) toast.success("Submitted successfully.");
    } catch (e) {
      toast.error(e.message || "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  }

  const resultRows = useMemo(() => {
    if (!result) return [];
    return questions.map((question, i) => {
      const answer = result.answers[i];
      const chosenText = typeof answer?.chosenIndex === "number" ? question.options[answer.chosenIndex] : "Not answered";
      const correctText = question.options[question.correctAnswerIndex];
      return { question, answer, isCorrect: Boolean(answer?.isCorrect), chosenText, correctText };
    });
  }, [questions, result]);

  const inputBase = "w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  // Timer color
  const timerColor = timeLeft !== null && timeLeft <= 60 ? "text-red-600"
    : timeLeft !== null && timeLeft <= 300 ? "text-amber-600"
    : "text-gray-600";

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="flex min-h-screen items-center justify-center bg-gray-100"><p className="text-sm text-red-600">{error}</p></div>;
  if (!quiz) return null;

  // ── Gate ───────────────────────────────────────────────────────────────────
  if (!gateOpen) {
    const hasTimer = Boolean(quiz.settings?.timer);
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 font-sans">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-8 shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">PulseCheck · Quiz</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{quiz.title}</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Assigned by <span className="font-medium text-gray-700">{quiz.teacherName || "your teacher"}</span>
          </p>

          {/* Quiz meta — made prominent */}
          <div className="mt-5 flex flex-wrap gap-3">
            <div className="flex-1 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-center">
              <p className="text-2xl font-bold text-gray-900">{quiz.questions?.length || 0}</p>
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">Questions</p>
            </div>
            {hasTimer && (
              <div className="flex-1 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{quiz.settings.timer}</p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">Minutes</p>
              </div>
            )}
            {!hasTimer && (
              <div className="flex-1 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-gray-900">∞</p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">No Time Limit</p>
              </div>
            )}
          </div>

          {quiz.instructions && (
            <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Instructions</p>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{quiz.instructions}</p>
            </div>
          )}

          <div className="mt-5 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">Your Name</label>
              <input
                className={inputBase}
                placeholder="Enter your full name"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && openGate()}
              />
            </div>
            {quiz?.settings?.password && (
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">Quiz Password</label>
                <input
                  className={inputBase}
                  type="password"
                  placeholder="Enter the quiz password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && openGate()}
                />
              </div>
            )}
          </div>

          <button
            className="mt-5 w-full rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            onClick={openGate}
          >
            Start Quiz →
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (result) {
    const scorePct = totalQuestions ? Math.round((result.score / totalQuestions) * 100) : 0;
    return (
      <div className="min-h-screen bg-gray-100 font-sans">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-6 rounded-lg border border-gray-200 bg-white p-8 text-center"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Quiz Complete</p>
            <p className="mt-3 text-6xl font-bold text-gray-900">
              {result.score}<span className="text-3xl font-normal text-gray-400">/{totalQuestions}</span>
            </p>
            <p className="mt-1 text-xl font-medium text-gray-500">{scorePct}%</p>
            <p className="mt-2 text-sm text-gray-400">Well done, {studentName}.</p>
          </motion.div>

          <div className="space-y-3">
            {resultRows.map((row, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: idx * 0.04 }}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Question {idx + 1}</p>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    row.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                  }`}>
                    {row.isCorrect ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <p className="mt-2 font-medium text-gray-900">{row.question.text}</p>

                <div className="mt-3 space-y-1.5">
                  {row.question.options.map((option, oi) => {
                    const isChosen = row.answer?.chosenIndex === oi;
                    const isCorrect = row.question.correctAnswerIndex === oi;
                    return (
                      <div
                        key={oi}
                        className={`rounded border px-3 py-2 text-sm ${
                          isCorrect ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : isChosen ? "border-red-300 bg-red-50 text-red-700"
                          : "border-gray-200 bg-white text-gray-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span><span className="mr-2 font-mono text-xs opacity-50">{String.fromCharCode(65 + oi)}</span>{option}</span>
                          <span className="shrink-0 text-xs font-medium">
                            {isCorrect && "✓ Correct"}
                            {isChosen && !isCorrect && "Your answer"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex flex-wrap gap-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  <span><span className="font-medium text-gray-700">Time:</span> {row.answer?.timeSpentSeconds ?? 0}s</span>
                  <span><span className="font-medium text-gray-700">Confidence:</span> {row.answer?.confidence ?? "—"}/5</span>
                </div>
                {row.question.aiRationale && (
                  <p className="mt-2 text-xs text-gray-400">
                    <span className="font-medium">Rationale:</span> {row.question.aiRationale}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Quiz ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8 sm:px-6">

        {/* Progress bar */}
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span className="font-medium text-gray-700">{quiz.title}</span>
            <div className="flex items-center gap-3">
              {/* Timer */}
              {timeLeft !== null && (
                <div className="flex items-center gap-1.5">
                  {showTimer && (
                    <span className={`font-mono text-sm font-semibold tabular-nums ${timerColor}`}>
                      {formatTime(timeLeft)}
                    </span>
                  )}
                  <button
                    onClick={() => setShowTimer((v) => !v)}
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-50"
                    title={showTimer ? "Hide timer" : "Show timer"}
                  >
                    {showTimer ? "Hide" : "Show time"}
                  </button>
                </div>
              )}
              <span className="text-gray-400">
                {currentQuestionIndex + 1} / {totalQuestions}
              </span>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <motion.div
              className="h-1.5 rounded-full bg-blue-600"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Question card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQuestionIndex}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="rounded-lg border border-gray-200 bg-white p-6"
          >
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
              Question {currentQuestionIndex + 1}
            </p>
            <p className="text-lg font-semibold text-gray-900">{currentQuestion.text}</p>

            <div className="mt-5 space-y-2">
              {currentQuestion.options.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={`w-full rounded border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    selectedIndex === index
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <span className="mr-3 font-mono text-xs text-gray-400">{String.fromCharCode(65 + index)}</span>
                  {option}
                </button>
              ))}
            </div>

            {/* Confidence */}
            <div className="mt-5 rounded border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-600">Confidence</p>
                <span className="text-sm font-semibold text-gray-900">{confidence} / 5</span>
              </div>
              <input
                className="w-full accent-blue-600"
                type="range" min="1" max="5" step="1"
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>Guessing</span>
                <span>Certain</span>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Next / Submit */}
        <div className="mt-4">
          <button
            className="w-full rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            onClick={handleNext}
            disabled={submitting}
          >
            {currentQuestionIndex === totalQuestions - 1
              ? submitting ? "Submitting..." : "Submit Quiz"
              : "Next →"}
          </button>
        </div>

      </div>
    </div>
  );
}

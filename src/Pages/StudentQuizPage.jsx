import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import toast from "react-hot-toast";
import { db } from "../lib/firebase";

export default function StudentQuizPage() {
  const { quizId } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [gateOpen, setGateOpen] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [passwordInput, setPasswordInput] = useState("");

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [confidence, setConfidence] = useState(3);
  const [questionStartTime, setQuestionStartTime] = useState(Date.now());
  const [answers, setAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const questions = quiz?.questions || [];
  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const progress = totalQuestions ? ((currentQuestionIndex + 1) / totalQuestions) * 100 : 0;

  useEffect(() => {
    async function loadQuiz() {
      try {
        setLoading(true);
        const snap = await getDoc(doc(db, "quizzes", quizId));
        if (!snap.exists()) {
          setError("Quiz not found.");
          return;
        }
        setQuiz({ id: snap.id, ...snap.data() });
      } catch (loadError) {
        setError(loadError.message || "Failed to load quiz.");
      } finally {
        setLoading(false);
      }
    }

    if (quizId) loadQuiz();
  }, [quizId]);

  useEffect(() => {
    if (!gateOpen) return;
    setQuestionStartTime(Date.now());
    setSelectedIndex(null);
    setConfidence(3);
  }, [currentQuestionIndex, gateOpen]);

  function openGate() {
    const requiredPassword = quiz?.settings?.password?.trim();
    if (!studentName.trim()) {
      toast.error("Please enter your name.");
      return;
    }
    if (requiredPassword && passwordInput !== requiredPassword) {
      toast.error("Incorrect password.");
      return;
    }
    setQuestionStartTime(Date.now());
    setGateOpen(true);
  }

  function captureCurrentAnswer() {
    const timeSpentSeconds = Math.max(
      1,
      Math.round((Date.now() - questionStartTime) / 1000)
    );

    return {
      questionId: currentQuestion.id,
      chosenIndex: selectedIndex,
      isCorrect: selectedIndex === currentQuestion.correctAnswerIndex,
      timeSpentSeconds,
      confidence,
    };
  }

  function handleNext() {
    if (selectedIndex === null) {
      toast.error("Please choose an answer first.");
      return;
    }

    const answerPayload = captureCurrentAnswer();
    const nextAnswers = [...answers, answerPayload];
    setAnswers(nextAnswers);

    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      return;
    }

    handleSubmit(nextAnswers);
  }

  async function handleSubmit(finalAnswers) {
    try {
      setSubmitting(true);
      const score = finalAnswers.filter((answer) => answer.isCorrect).length;

      await addDoc(collection(db, "submissions"), {
        quizId,
        ownerId: quiz.ownerId || null,
        studentName: studentName.trim(),
        score,
        isLive: false,
        answers: finalAnswers,
        createdAt: serverTimestamp(),
      });

      setResult({
        score,
        answers: finalAnswers,
      });
      toast.success("Submitted successfully.");
    } catch (submitError) {
      toast.error(submitError.message || "Failed to submit quiz.");
    } finally {
      setSubmitting(false);
    }
  }

  const resultRows = useMemo(() => {
    if (!result) return [];
    return questions.map((question, index) => {
      const answer = result.answers[index];
      const chosenText =
        typeof answer?.chosenIndex === "number" ? question.options[answer.chosenIndex] : "No answer";
      const correctText = question.options[question.correctAnswerIndex];
      return {
        question,
        questionAnswer: answer,
        isCorrect: Boolean(answer?.isCorrect),
        chosenText,
        correctText,
      };
    });
  }, [questions, result]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-700">Loading quiz...</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-rose-600">{error}</div>;
  }

  if (!quiz) return null;

  if (!gateOpen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <p className="text-xs uppercase tracking-widest text-indigo-300">Welcome</p>
          <h1 className="mt-2 text-3xl font-bold text-white">{quiz.title}</h1>
          <p className="mt-3 text-sm text-slate-200">
            Your teacher <span className="font-semibold">{quiz.teacherName || "Teacher"}</span> has invited
            you to take <span className="font-semibold">{quiz.title}</span>.
          </p>
          {quiz.instructions ? (
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Instructions</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{quiz.instructions}</p>
            </div>
          ) : null}
          <p className="mt-4 text-sm text-slate-300">Enter your details to start.</p>
          <input
            className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-white"
            placeholder="Your name"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
          />
          {quiz?.settings?.password ? (
            <input
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-white"
              placeholder="Quiz password"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
          ) : null}
          <button
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-3 text-white"
            onClick={openGate}
          >
            Start Quiz
          </button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-slate-100 p-6 md:p-10">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Quiz Complete</p>
            <p className="mt-3 text-5xl font-bold text-slate-900">
              {result.score}/{questions.length}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Nice work, {studentName}. Review each answer below.
            </p>
          </div>
          {resultRows.map((row, idx) => (
            <div
              key={row.question.id || idx}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-500">Question {idx + 1}</p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    row.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {row.isCorrect ? "Correct" : "Incorrect"}
                </span>
              </div>
              <p className="mt-3 text-lg font-semibold text-slate-900">
                {idx + 1}. {row.question.text}
              </p>

              <div className="mt-4 space-y-2">
                {row.question.options.map((option, optionIndex) => {
                  const isChosen = row.questionAnswer?.chosenIndex === optionIndex;
                  const isCorrect = row.question.correctAnswerIndex === optionIndex;
                  return (
                    <div
                      key={`${row.question.id || idx}-${optionIndex}`}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        isChosen && isCorrect
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : isCorrect
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : isChosen
                              ? "border-rose-300 bg-rose-50 text-rose-700"
                              : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{option}</span>
                        <span className="text-xs font-semibold">
                          {isCorrect ? "Correct" : ""}
                          {isCorrect && isChosen ? " + " : ""}
                          {isChosen ? "Your choice" : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-2">
                <p className="text-sm text-slate-700">
                  <span className="font-medium">Time taken:</span>{" "}
                  {row.questionAnswer?.timeSpentSeconds ?? 0}s
                </p>
                <p className="text-sm text-slate-700">
                  <span className="font-medium">Confidence:</span> {row.questionAnswer?.confidence ?? "-"} / 5
                </p>
              </div>

              <p className="mt-4 text-sm text-slate-700">
                <span className="font-medium">AI Rationale:</span>{" "}
                {row.question.aiRationale || "No rationale available."}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              Question {currentQuestionIndex + 1} / {totalQuestions}
            </span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-200">
            <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">{quiz.title}</h1>
          <p className="mt-4 text-lg font-semibold text-slate-900">{currentQuestion.text}</p>

          <div className="mt-4 grid gap-2">
            {currentQuestion.options.map((option, index) => (
              <button
                key={`${currentQuestion.id}-${index}`}
                type="button"
                className={`rounded-lg border px-4 py-3 text-left ${
                  selectedIndex === index
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
                onClick={() => setSelectedIndex(index)}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700">How sure are you about this answer?</p>
            <input
              className="mt-3 w-full"
              type="range"
              min="1"
              max="5"
              step="1"
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
            />
            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>1 (Guessing)</span>
              <span>Confidence: {confidence}</span>
              <span>5 (Certain)</span>
            </div>
          </div>
        </div>

        <div>
          <button
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-white disabled:bg-slate-300"
            onClick={handleNext}
            disabled={submitting}
          >
            {currentQuestionIndex === totalQuestions - 1
              ? submitting
                ? "Submitting..."
                : "Submit Quiz"
              : "Next Question"}
          </button>
        </div>
      </div>
    </div>
  );
}


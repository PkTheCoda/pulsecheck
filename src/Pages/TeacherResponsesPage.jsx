import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { FiActivity, FiBarChart2, FiClock, FiUsers } from "react-icons/fi";
import { db } from "../lib/firebase";

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "0s";
  if (value < 60) return `${Math.round(value)}s`;
  const mins = Math.floor(value / 60);
  const secs = Math.round(value % 60);
  return `${mins}m ${secs}s`;
}

function pct(value, total) {
  if (!total) return 0;
  return (value / total) * 100;
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <Icon className="text-slate-500" />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export default function TeacherResponsesPage({ user }) {
  const { quizId } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState("summary");
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);

  useEffect(() => {
    async function loadQuiz() {
      if (!quizId || !user) return;
      try {
        const quizSnap = await getDoc(doc(db, "quizzes", quizId));
        if (!quizSnap.exists()) {
          setError("Quiz not found.");
          setLoading(false);
          return;
        }

        const quizData = { id: quizSnap.id, ...quizSnap.data() };
        if (quizData.ownerId !== user.uid) {
          setError("You do not have access to this quiz.");
          setLoading(false);
          return;
        }

        setQuiz(quizData);
      } catch (quizError) {
        setError(quizError.message || "Failed to load quiz.");
        setLoading(false);
      }
    }

    loadQuiz();
  }, [quizId, user]);

  useEffect(() => {
    if (!quizId || !user) return undefined;

    const q = query(collection(db, "submissions"), where("quizId", "==", quizId));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        next.sort((a, b) => (b?.createdAt?.toMillis?.() || 0) - (a?.createdAt?.toMillis?.() || 0));
        setSubmissions(next);
        if (!selectedSubmissionId && next[0]) setSelectedSubmissionId(next[0].id);
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message || "Failed to load submissions.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [quizId, user, selectedSubmissionId]);

  const summary = useMemo(() => {
    const totalResponses = submissions.length;
    const totalQuestions = quiz?.questions?.length || 0;
    const averageScore =
      totalResponses === 0
        ? 0
        : submissions.reduce((acc, item) => acc + (item.score || 0), 0) / totalResponses;

    const allAnswers = submissions.flatMap((submission) => submission.answers || []);
    const averageTime =
      allAnswers.length === 0
        ? 0
        : allAnswers.reduce((acc, answer) => acc + (answer.timeSpentSeconds || 0), 0) / allAnswers.length;
    const averageConfidence =
      allAnswers.length === 0
        ? 0
        : allAnswers.reduce((acc, answer) => acc + (answer.confidence || 0), 0) / allAnswers.length;

    const highConfWrong = allAnswers.filter(
      (answer) => !answer.isCorrect && Number(answer.confidence) >= 4
    ).length;
    const lowConfRight = allAnswers.filter(
      (answer) => answer.isCorrect && Number(answer.confidence) <= 2
    ).length;
    const lowConfWrong = allAnswers.filter(
      (answer) => !answer.isCorrect && Number(answer.confidence) <= 2
    ).length;

    return {
      totalResponses,
      totalQuestions,
      averageScore,
      averageTime,
      averageConfidence,
      highConfWrong,
      lowConfRight,
      lowConfWrong,
      totalAnswerEvents: allAnswers.length,
    };
  }, [submissions, quiz]);

  const questionStats = useMemo(() => {
    const questions = quiz?.questions || [];
    return questions.map((question, questionIndex) => {
      const answers = submissions
        .map((submission) => submission.answers?.[questionIndex])
        .filter(Boolean);
      const total = answers.length;
      const correctCount = answers.filter((answer) => answer.isCorrect).length;
      const averageTime =
        total === 0 ? 0 : answers.reduce((acc, answer) => acc + (answer.timeSpentSeconds || 0), 0) / total;
      const averageConfidence =
        total === 0 ? 0 : answers.reduce((acc, answer) => acc + (answer.confidence || 0), 0) / total;

      const optionCounts = question.options.map((_, optionIndex) =>
        answers.filter((answer) => answer.chosenIndex === optionIndex).length
      );

      return {
        question,
        questionIndex,
        total,
        correctRate: total ? (correctCount / total) * 100 : 0,
        averageTime,
        averageConfidence,
        optionCounts,
      };
    });
  }, [quiz, submissions]);

  const tossUpQuestions = useMemo(() => {
    return questionStats
      .map((row) => {
        const total = row.total || 0;
        if (!total) return null;
        const correctIndex = row.question.correctAnswerIndex;
        const correctCount = row.optionCounts[correctIndex] || 0;
        const correctPct = pct(correctCount, total);
        if (correctPct <= 30) return null;

        let topWrongIndex = -1;
        let topWrongCount = 0;
        row.optionCounts.forEach((count, optionIndex) => {
          if (optionIndex === correctIndex) return;
          if (count > topWrongCount) {
            topWrongCount = count;
            topWrongIndex = optionIndex;
          }
        });
        const wrongPct = pct(topWrongCount, total);
        if (topWrongIndex < 0 || wrongPct <= 30) return null;

        return {
          questionIndex: row.questionIndex,
          questionText: row.question.text,
          correctOptionText: row.question.options[correctIndex],
          correctPct,
          wrongOptionText: row.question.options[topWrongIndex],
          wrongPct,
        };
      })
      .filter(Boolean);
  }, [questionStats]);

  const struggleTags = useMemo(() => {
    const conceptStats = {};
    (quiz?.questions || []).forEach((question, questionIndex) => {
      const concept = question?.tags?.concept || "Uncategorized";
      if (!conceptStats[concept]) conceptStats[concept] = { concept, total: 0, correct: 0 };
      submissions.forEach((submission) => {
        const answer = submission.answers?.[questionIndex];
        if (!answer) return;
        conceptStats[concept].total += 1;
        if (answer.isCorrect) conceptStats[concept].correct += 1;
      });
    });

    return Object.values(conceptStats)
      .map((entry) => ({
        ...entry,
        accuracy: pct(entry.correct, entry.total),
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  }, [quiz, submissions]);

  const stdAlerts = useMemo(() => {
    if (submissions.length === 0) return { mean: 0, stdDev: 0, threshold: 0, flagged: [] };
    const scores = submissions.map((s) => Number(s.score || 0));
    const mean = scores.reduce((acc, value) => acc + value, 0) / scores.length;
    const variance =
      scores.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean - 1.5 * stdDev;
    const flagged = submissions.filter((s) => Number(s.score || 0) < threshold);
    return { mean, stdDev, threshold, flagged };
  }, [submissions]);

  const clickHappy = useMemo(() => {
    const rows = submissions
      .map((submission) => {
        const count = (submission.answers || []).filter(
          (answer) => !answer.isCorrect && Number(answer.timeSpentSeconds) < 3
        ).length;
        return {
          id: submission.id,
          studentName: submission.studentName || "Unnamed",
          count,
          flagged: count > 2,
        };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
    return rows;
  }, [submissions]);

  const selectedSubmission = submissions.find((submission) => submission.id === selectedSubmissionId);
  const studentsByQuestion = useMemo(() => {
    const question = quiz?.questions?.[selectedQuestionIndex];
    if (!question) return { correctStudents: [], incorrectStudents: [] };

    const correctStudents = [];
    const incorrectStudents = [];
    submissions.forEach((submission) => {
      const answer = submission.answers?.[selectedQuestionIndex];
      if (!answer) return;
      const student = { id: submission.id, name: submission.studentName || "Unnamed" };
      if (answer.isCorrect) {
        correctStudents.push(student);
      } else {
        incorrectStudents.push(student);
      }
    });

    return { correctStudents, incorrectStudents };
  }, [quiz, submissions, selectedQuestionIndex]);

  if (!user) return <Navigate to="/signin" replace />;

  if (loading) return <div className="p-6 text-sm text-slate-700">Loading responses...</div>;
  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>;

  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Responses</p>
              <h1 className="text-3xl font-bold text-slate-900">{quiz?.title}</h1>
              <p className="mt-1 text-sm text-slate-600">
                {submissions.length} submissions • {quiz?.questions?.length || 0} questions
              </p>
            </div>
            <Link to="/dashboard" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              Back to Dashboard
            </Link>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              className={`rounded-lg px-3 py-2 text-sm ${viewMode === "summary" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
              onClick={() => setViewMode("summary")}
            >
              Summary
            </button>
            <button
              className={`rounded-lg px-3 py-2 text-sm ${viewMode === "question" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
              onClick={() => setViewMode("question")}
            >
              Question
            </button>
            <button
              className={`rounded-lg px-3 py-2 text-sm ${viewMode === "individual" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
              onClick={() => setViewMode("individual")}
            >
              Individual
            </button>
          </div>
        </header>

        {viewMode === "summary" && (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              <StatCard icon={FiUsers} label="Responses" value={summary.totalResponses} />
              <StatCard
                icon={FiBarChart2}
                label="Average Score"
                value={`${summary.averageScore.toFixed(1)}/${summary.totalQuestions}`}
              />
              <StatCard
                icon={FiClock}
                label="Avg Time / Question"
                value={formatSeconds(summary.averageTime)}
              />
              <StatCard
                icon={FiActivity}
                label="Avg Confidence"
                value={`${summary.averageConfidence.toFixed(1)}/5`}
              />
            </section>

            {tossUpQuestions.length > 0 && (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">Toss-Up (Class Split)</p>
                <p className="mt-1 text-xs text-slate-500">
                  Questions where the class is split between the correct answer and one specific wrong answer
                  (both above 30%).
                </p>
                <div className="mt-3 space-y-2">
                  {tossUpQuestions.map((item) => (
                    <div key={`tossup-${item.questionIndex}`} className="rounded-xl border border-slate-200 p-3">
                      <p className="text-sm font-medium text-slate-900">
                        Q{item.questionIndex + 1}: {item.questionText}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Correct option: <span className="font-semibold text-emerald-700">{item.correctOptionText}</span>{" "}
                        ({item.correctPct.toFixed(0)}%)
                      </p>
                      <p className="text-xs text-slate-600">
                        Top wrong option: <span className="font-semibold text-rose-700">{item.wrongOptionText}</span>{" "}
                        ({item.wrongPct.toFixed(0)}%)
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-semibold text-slate-900">Struggle List (Topic Ranking)</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Bottom 3 concept tags by average correctness. Use this to decide what to reteach first.
                  </p>
                  <div className="mt-3 space-y-2">
                    {struggleTags.map((tag) => (
                      <div key={tag.concept} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-slate-800">{tag.concept}</p>
                          <p className="text-sm font-semibold text-slate-900">{tag.accuracy.toFixed(0)}%</p>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-200">
                          <div className="h-2 rounded-full bg-slate-700" style={{ width: `${tag.accuracy}%` }} />
                        </div>
                      </div>
                    ))}
                    {struggleTags.length === 0 && <p className="text-xs text-slate-500">No tag data yet.</p>}
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">Standard Deviation Alerts</p>
                <p className="mt-1 text-xs text-slate-500">
                  Students below (class mean - 1.5 × standard deviation). Good for identifying outliers who may need support.
                </p>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Mean: {stdAlerts.mean.toFixed(2)} | Std Dev: {stdAlerts.stdDev.toFixed(2)} | Alert Threshold:{" "}
                  {stdAlerts.threshold.toFixed(2)}
                </div>
                <div className="mt-3 space-y-2">
                  {stdAlerts.flagged.map((student) => (
                    <div key={`std-${student.id}`} className="rounded-xl border border-rose-200 p-3">
                      <p className="text-sm font-medium text-slate-900">{student.studentName || "Unnamed"}</p>
                      <p className="text-xs text-rose-700">Score {student.score} is below threshold</p>
                    </div>
                  ))}
                  {stdAlerts.flagged.length === 0 && <p className="text-xs text-slate-500">No outlier alerts.</p>}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Click-Happy Errors (Carelessness)</p>
              <p className="mt-1 text-xs text-slate-500">
                Incorrect answers submitted in under 3 seconds. Students with more than 2 are flagged.
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {clickHappy.map((row) => (
                  <div
                    key={`click-${row.id}`}
                    className={`rounded-xl border p-3 ${row.flagged ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50"}`}
                  >
                    <p className="text-sm font-medium text-slate-900">{row.studentName}</p>
                    <p className={`text-xs ${row.flagged ? "text-rose-700" : "text-slate-600"}`}>
                      {row.count} fast incorrect answers {row.flagged ? "(flagged)" : ""}
                    </p>
                  </div>
                ))}
                {clickHappy.length === 0 && <p className="text-xs text-slate-500">No click-happy errors found.</p>}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Class Matrix (Top-Level View)</p>
              <p className="mt-1 text-xs text-slate-500">
                Rows are questions, columns are students. Each cell shows whether a student got that question right.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border bg-slate-100 px-3 py-2 text-left text-slate-700">
                        Question
                      </th>
                      {submissions.map((submission, idx) => (
                        <th key={`head-${submission.id}`} className="border bg-slate-100 px-3 py-2 text-slate-700">
                          {(submission.studentName || `Student ${idx + 1}`).slice(0, 14)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(quiz?.questions || []).map((question, qIndex) => (
                      <tr key={`matrix-row-${qIndex}`}>
                        <td className="sticky left-0 z-10 border bg-white px-3 py-2 font-medium text-slate-800">
                          Q{qIndex + 1}
                        </td>
                        {submissions.map((submission) => {
                          const answer = submission.answers?.[qIndex];
                          const correct = Boolean(answer?.isCorrect);
                          return (
                            <td
                              key={`cell-${submission.id}-${qIndex}`}
                              className={`border px-3 py-2 text-center ${answer ? (correct ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700") : "bg-slate-50 text-slate-400"}`}
                            >
                              {!answer ? "-" : correct ? "Correct" : "Wrong"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {viewMode === "question" && (
          <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={selectedQuestionIndex <= 0}
                onClick={() => setSelectedQuestionIndex((prev) => Math.max(0, prev - 1))}
              >
                Previous
              </button>
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={selectedQuestionIndex >= (quiz?.questions?.length || 1) - 1}
                onClick={() =>
                  setSelectedQuestionIndex((prev) =>
                    Math.min((quiz?.questions?.length || 1) - 1, prev + 1)
                  )
                }
              >
                Next
              </button>
              <div className="ml-2 flex flex-wrap gap-1">
                {(quiz?.questions || []).map((question, index) => (
                  <button
                    key={question.id || index}
                    className={`rounded-md px-2 py-1 text-xs ${
                      index === selectedQuestionIndex
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300 text-slate-700"
                    }`}
                    onClick={() => setSelectedQuestionIndex(index)}
                  >
                    Q{index + 1}
                  </button>
                ))}
              </div>
            </div>

            {questionStats[selectedQuestionIndex] ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-slate-500">Prompt</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {questionStats[selectedQuestionIndex].question.text}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border p-3">
                    <p className="text-xs text-slate-500">Correct Rate</p>
                    <p className="text-xl font-bold">
                      {questionStats[selectedQuestionIndex].correctRate.toFixed(0)}%
                    </p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <p className="text-xs text-slate-500">Avg Time</p>
                    <p className="text-xl font-bold">
                      {formatSeconds(questionStats[selectedQuestionIndex].averageTime)}
                    </p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <p className="text-xs text-slate-500">Avg Confidence</p>
                    <p className="text-xl font-bold">
                      {questionStats[selectedQuestionIndex].averageConfidence.toFixed(1)}/5
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {questionStats[selectedQuestionIndex].question.options.map((option, optionIndex) => {
                    const count = questionStats[selectedQuestionIndex].optionCounts[optionIndex] || 0;
                    const total = questionStats[selectedQuestionIndex].total || 1;
                    const width = (count / total) * 100;
                    const isCorrect =
                      optionIndex === questionStats[selectedQuestionIndex].question.correctAnswerIndex;
                    return (
                      <div key={`${option}-${optionIndex}`}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className={isCorrect ? "font-semibold text-emerald-700" : "text-slate-700"}>
                            {option}
                          </span>
                          <span className="text-slate-500">{count}</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-200">
                          <div
                            className={`h-2 rounded-full ${isCorrect ? "bg-emerald-500" : "bg-indigo-500"}`}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-semibold uppercase text-emerald-700">Got It Right</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {studentsByQuestion.correctStudents.length === 0 ? (
                        <span className="text-xs text-emerald-800">No one yet</span>
                      ) : (
                        studentsByQuestion.correctStudents.map((student) => (
                          <span
                            key={`right-${student.id}`}
                            className="rounded-full bg-white px-2 py-1 text-xs text-emerald-700"
                          >
                            {student.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                    <p className="text-xs font-semibold uppercase text-rose-700">Got It Wrong</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {studentsByQuestion.incorrectStudents.length === 0 ? (
                        <span className="text-xs text-rose-800">No one yet</span>
                      ) : (
                        studentsByQuestion.incorrectStudents.map((student) => (
                          <span
                            key={`wrong-${student.id}`}
                            className="rounded-full bg-white px-2 py-1 text-xs text-rose-700"
                          >
                            {student.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No data yet.</p>
            )}
          </section>
        )}

        {viewMode === "individual" && (
          <section className="grid gap-4 md:grid-cols-[260px_1fr]">
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <p className="mb-2 text-sm font-semibold text-slate-800">Students</p>
              <div className="space-y-2">
                {submissions.map((submission) => (
                  <button
                    key={submission.id}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      selectedSubmissionId === submission.id
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-800"
                    }`}
                    onClick={() => setSelectedSubmissionId(submission.id)}
                  >
                    <p className="font-medium">{submission.studentName || "Unnamed"}</p>
                    <p className="text-xs opacity-80">Score: {submission.score ?? 0}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              {!selectedSubmission ? (
                <p className="text-sm text-slate-600">No submission selected.</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-500">Student</p>
                    <p className="text-xl font-bold text-slate-900">{selectedSubmission.studentName}</p>
                    <p className="text-sm text-slate-600">
                      Score: {selectedSubmission.score ?? 0}/{quiz?.questions?.length || 0}
                    </p>
                  </div>
                  {(quiz?.questions || []).map((question, index) => {
                    const answer = selectedSubmission.answers?.[index];
                    const chosenText =
                      typeof answer?.chosenIndex === "number"
                        ? question.options[answer.chosenIndex]
                        : "No answer";
                    const correctText = question.options[question.correctAnswerIndex];
                    return (
                      <div key={question.id || index} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-medium text-slate-900">
                          {index + 1}. {question.text}
                        </p>
                        <p className={`mt-1 text-sm ${answer?.isCorrect ? "text-emerald-600" : "text-rose-600"}`}>
                          {answer?.isCorrect ? "Correct" : "Incorrect"}
                        </p>
                        <p className="mt-1 text-sm text-slate-700">Selected: {chosenText}</p>
                        <p className="text-sm text-slate-700">Correct: {correctText}</p>
                        <p className="text-xs text-slate-500">
                          Confidence: {answer?.confidence ?? "-"} | Time: {formatSeconds(answer?.timeSpentSeconds ?? 0)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}


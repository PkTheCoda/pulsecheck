import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, Cell,
} from "recharts";
import toast from "react-hot-toast";
import { FiRefreshCw, FiShare2 } from "react-icons/fi";
import { db } from "../lib/firebase";
import { generateInsightsWithGemini } from "../lib/gemini";
import SiteHeader from "../Components/SiteHeader";
import { usePageTitle } from "../hooks/usePageTitle";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatSeconds(v) {
  if (!Number.isFinite(v)) return "0s";
  if (v < 60) return `${Math.round(v)}s`;
  return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`;
}
function pct(v, t) { return t ? (v / t) * 100 : 0; }
function barBg(p) { return p >= 70 ? "bg-emerald-500" : p >= 40 ? "bg-amber-400" : "bg-red-500"; }
function barText(p) { return p >= 70 ? "text-emerald-600" : p >= 40 ? "text-amber-600" : "text-red-600"; }

// ─── animation variants ───────────────────────────────────────────────────────

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } };
const staggerContainer = { animate: { transition: { staggerChildren: 0.05 } } };
const staggerItem = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

// ─── sub-components ──────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
        <p className="text-sm text-gray-500">Loading responses...</p>
      </div>
    </div>
  );
}

/** Score distribution bar chart (histogram) */
function ScoreHistogram({ submissions, totalQuestions }) {
  const { data, mean } = useMemo(() => {
    if (!submissions.length || !totalQuestions) return { data: [], mean: 0 };
    const counts = {};
    for (let i = 0; i <= totalQuestions; i++) counts[i] = 0;
    submissions.forEach((s) => { counts[s.score || 0]++; });
    const m = submissions.reduce((a, s) => a + (s.score || 0), 0) / submissions.length;
    return {
      data: Object.entries(counts).map(([score, count]) => ({
        score: `${score}/${totalQuestions}`, rawScore: Number(score), count,
      })),
      mean: m,
    };
  }, [submissions, totalQuestions]);

  if (!data.length) return null;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
        <p className="font-medium text-gray-900">Score: {payload[0]?.payload?.score}</p>
        <p className="text-gray-500">{payload[0]?.value} student{payload[0]?.value !== 1 ? "s" : ""}</p>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="score" tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} width={28} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.score}
              fill={entry.rawScore === Math.round(mean) ? "#2563eb" : "#3b82f6"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Confidence vs. score scatter chart */
function ConfidenceScatterChart({ submissions, totalQuestions }) {
  const data = useMemo(() => submissions.map((s) => {
    const ans = s.answers || [];
    const avgConf = ans.length ? ans.reduce((a, x) => a + (x.confidence || 3), 0) / ans.length : 3;
    const scorePct = totalQuestions ? Math.round(((s.score || 0) / totalQuestions) * 100) : 0;
    return { avgConfidence: Number(avgConf.toFixed(2)), scorePct, name: s.studentName || "?" };
  }), [submissions, totalQuestions]);

  if (!data.length) return null;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
        <p className="font-semibold text-gray-900">{d?.name}</p>
        <p className="text-gray-500">Avg confidence: {d?.avgConfidence?.toFixed(1)}</p>
        <p className="text-gray-500">Score: {d?.scorePct}%</p>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis
          type="number" dataKey="avgConfidence" name="Avg Confidence"
          domain={[1, 5]} tickCount={5}
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          label={{ value: "Avg Confidence →", position: "insideBottom", offset: -14, fontSize: 11, fill: "#9ca3af" }}
        />
        <YAxis
          type="number" dataKey="scorePct" name="Score %"
          domain={[0, 100]} tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "#9ca3af" }} width={36}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={data} fill="#3b82f6" fillOpacity={0.85} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Avg time per question bar chart */
function QuestionTimeChart({ questionStats }) {
  const data = questionStats.map((q) => ({
    name: `Q${q.questionIndex + 1}`,
    avgTime: Math.round(q.avgTime),
  }));

  if (!data.length) return null;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-gray-500">Avg time: {payload[0]?.value}s</p>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <YAxis tickFormatter={(v) => `${v}s`} tick={{ fontSize: 11, fill: "#9ca3af" }} width={36} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="avgTime" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Collapsible section wrapper */
function Collapsible({ title, defaultOpen = false, children, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        className="flex w-full items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-gray-700">{title}</span>
          {badge != null && (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">{badge}</span>
          )}
        </div>
        <span className="text-xs text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div className="border-t border-gray-100 px-5 pb-5 pt-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function getCalibration(answers) {
  if (!answers?.length) return null;
  const avgAcc = answers.reduce((a, x) => a + (x.isCorrect ? 1 : 0), 0) / answers.length;
  const avgConf = answers.reduce((a, x) => a + (x.confidence || 3), 0) / answers.length / 5;
  const diff = avgConf - avgAcc;
  if (diff > 0.15) return { label: "Overconfident", color: "amber" };
  if (diff < -0.15) return { label: "Underconfident", color: "blue" };
  return { label: "Well-calibrated", color: "emerald" };
}

function exportCSV(submissions, quiz) {
  if (!submissions.length) return;
  const questions = quiz?.questions || [];
  const headers = [
    "Student Name", "Score", "Score %",
    ...questions.flatMap((_, i) => [`Q${i + 1} Answer`, `Q${i + 1} Correct?`, `Q${i + 1} Confidence`, `Q${i + 1} Time (s)`]),
  ];
  const rows = submissions.map((s) => [
    s.studentName || "Unnamed",
    `${s.score ?? 0}/${questions.length}`,
    questions.length ? `${Math.round(((s.score || 0) / questions.length) * 100)}%` : "0%",
    ...questions.flatMap((q, i) => {
      const a = s.answers?.[i];
      return [
        typeof a?.chosenIndex === "number" ? q.options[a.chosenIndex] : "No answer",
        a ? (a.isCorrect ? "Yes" : "No") : "",
        a?.confidence ?? "",
        a?.timeSpentSeconds ?? "",
      ];
    }),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(quiz?.title || "quiz").replace(/[^a-z0-9]/gi, "_")}_responses.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── main component ───────────────────────────────────────────────────────────

export default function TeacherResponsesPage({ user }) {
  const { quizId } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState("summary");
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const geminiApiKey = import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";

  useEffect(() => {
    async function loadQuiz() {
      if (!quizId || !user) return;
      try {
        const snap = await getDoc(doc(db, "quizzes", quizId));
        if (!snap.exists()) { setError("Quiz not found."); setLoading(false); return; }
        const data = { id: snap.id, ...snap.data() };
        if (data.ownerId !== user.uid) { setError("Access denied."); setLoading(false); return; }
        setQuiz(data);

        // Load AI insights too
        const aiSnap = await getDoc(doc(db, "aiInsights", quizId));
        if (aiSnap.exists()) setInsights(aiSnap.data());
      } catch (e) { setError(e.message); setLoading(false); }
    }
    loadQuiz();
  }, [quizId, user]);

  useEffect(() => {
    if (!quizId || !user) return undefined;
    const q = query(collection(db, "submissions"), where("quizId", "==", quizId));
    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      next.sort((a, b) => (b?.createdAt?.toMillis?.() || 0) - (a?.createdAt?.toMillis?.() || 0));
      setSubmissions(next);
      if (!selectedStudentId && next[0]) setSelectedStudentId(next[0].id);
      setLoading(false);
    }, (e) => { setError(e.message); setLoading(false); });
    return () => unsub();
  }, [quizId, user, selectedStudentId]);

  // ── computed analytics ───────────────────────────────────────────────────

  const summary = useMemo(() => {
    const totalQ = quiz?.questions?.length || 0;
    const totalR = submissions.length;
    const avgScore = totalR === 0 ? 0 : submissions.reduce((a, s) => a + (s.score || 0), 0) / totalR;
    const allA = submissions.flatMap((s) => s.answers || []);
    const avgTime = allA.length ? allA.reduce((a, x) => a + (x.timeSpentSeconds || 0), 0) / allA.length : 0;
    const avgConf = allA.length ? allA.reduce((a, x) => a + (x.confidence || 0), 0) / allA.length : 0;
    return { totalR, totalQ, avgScore, avgTime, avgConf };
  }, [submissions, quiz]);

  const questionStats = useMemo(() => (quiz?.questions || []).map((q, qi) => {
    const ans = submissions.map((s) => s.answers?.[qi]).filter(Boolean);
    const total = ans.length;
    const correct = ans.filter((a) => a.isCorrect).length;
    const avgTime = total ? ans.reduce((a, x) => a + (x.timeSpentSeconds || 0), 0) / total : 0;
    const avgConf = total ? ans.reduce((a, x) => a + (x.confidence || 0), 0) / total : 0;
    const optionCounts = q.options.map((_, oi) => ans.filter((a) => a.chosenIndex === oi).length);
    return { question: q, questionIndex: qi, total, correctRate: total ? (correct / total) * 100 : 0, avgTime, avgConf, optionCounts };
  }), [quiz, submissions]);

  const tossUpQuestions = useMemo(() => questionStats.map((row) => {
    if (!row.total) return null;
    const ci = row.question.correctAnswerIndex;
    const cp = pct(row.optionCounts[ci] || 0, row.total);
    if (cp <= 30) return null;
    let wi = -1, wc = 0;
    row.optionCounts.forEach((c, i) => { if (i !== ci && c > wc) { wc = c; wi = i; } });
    const wp = pct(wc, row.total);
    if (wi < 0 || wp <= 30) return null;
    return { questionIndex: row.questionIndex, questionText: row.question.text, correctOptionText: row.question.options[ci], correctPct: cp, wrongOptionText: row.question.options[wi], wrongPct: wp };
  }).filter(Boolean), [questionStats]);

  const struggleTags = useMemo(() => {
    const map = {};
    (quiz?.questions || []).forEach((q, qi) => {
      const c = q?.tags?.concept || "Uncategorized";
      if (!map[c]) map[c] = { concept: c, total: 0, correct: 0 };
      submissions.forEach((s) => { const a = s.answers?.[qi]; if (!a) return; map[c].total++; if (a.isCorrect) map[c].correct++; });
    });
    return Object.values(map).map((e) => ({ ...e, accuracy: pct(e.correct, e.total) })).sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);
  }, [quiz, submissions]);

  const stdAlerts = useMemo(() => {
    if (!submissions.length) return { mean: 0, stdDev: 0, threshold: 0, flagged: [] };
    const scores = submissions.map((s) => Number(s.score || 0));
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const stdDev = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
    const threshold = mean - 1.5 * stdDev;
    return { mean, stdDev, threshold, flagged: submissions.filter((s) => Number(s.score || 0) < threshold) };
  }, [submissions]);

  const clickHappy = useMemo(() => submissions.map((s) => ({
    id: s.id, studentName: s.studentName || "Unnamed",
    count: (s.answers || []).filter((a) => !a.isCorrect && Number(a.timeSpentSeconds) < 3).length,
  })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count).map((r) => ({ ...r, flagged: r.count > 2 })), [submissions]);

  const percentileMap = useMemo(() => {
    if (!submissions.length) return {};
    const sorted = [...submissions].sort((a, b) => (a.score || 0) - (b.score || 0));
    return Object.fromEntries(submissions.map((s) => {
      const rank = sorted.filter((x) => (x.score || 0) < (s.score || 0)).length;
      return [s.id, Math.round((rank / submissions.length) * 100)];
    }));
  }, [submissions]);

  const studentsByQuestion = useMemo(() => {
    const q = quiz?.questions?.[selectedQuestionIndex];
    if (!q) return { correct: [], incorrect: [] };
    const correct = [], incorrect = [];
    submissions.forEach((s) => {
      const a = s.answers?.[selectedQuestionIndex];
      if (!a) return;
      (a.isCorrect ? correct : incorrect).push({ id: s.id, name: s.studentName || "Unnamed" });
    });
    return { correct, incorrect };
  }, [quiz, submissions, selectedQuestionIndex]);

  const rendered = insights?.insights;

  // Lean analytics payload for Gemini — only sends wrong answers per student
  const analyticsPayload = useMemo(() => {
    if (!quiz || !submissions.length) return null;
    const questions = quiz.questions || [];
    return {
      quizTitle: quiz.title || "",
      responseCount: submissions.length,
      questions: questions.map((q, qi) => ({
        label: `Q${qi + 1}`,
        text: q.text.slice(0, 80),
        concept: q?.tags?.concept || "Uncategorized",
        correctRate: questionStats[qi] ? Math.round(questionStats[qi].correctRate) : 0,
        avgConf: questionStats[qi] ? Number(questionStats[qi].avgConf.toFixed(1)) : 0,
      })),
      students: submissions.map((s) => ({
        name: s.studentName || "Unnamed",
        score: `${s.score ?? 0}/${questions.length}`,
        highConfWrong: (s.answers || []).filter((a) => !a.isCorrect && Number(a.confidence) >= 4).length,
        wrongAnswers: questions.map((q, qi) => {
          const a = s.answers?.[qi];
          if (!a || a.isCorrect) return null;
          return { q: `Q${qi + 1}`, chose: typeof a.chosenIndex === "number" ? q.options[a.chosenIndex] : "?", concept: q?.tags?.concept || "" };
        }).filter(Boolean),
      })),
    };
  }, [quiz, submissions, questionStats]);

  async function handleGenerate() {
    if (!geminiApiKey) { toast.error("Missing GEMINI_API_KEY / VITE_GEMINI_API_KEY in environment."); return; }
    if (!quiz || !analyticsPayload) return;
    try {
      setGenerating(true);
      const result = await generateInsightsWithGemini({
        apiKey: geminiApiKey,
        quizTitle: quiz.title,
        teacherName: quiz.teacherName || "",
        analyticsPayload,
      });
      const payload = { ownerId: quiz.ownerId, quizId, generatedAt: serverTimestamp(), insights: result };
      await setDoc(doc(db, "aiInsights", quizId), payload, { merge: true });
      await setDoc(doc(db, "studyGuides", quizId), {
        ownerId: quiz.ownerId, quizId, quizTitle: quiz.title,
        teacherName: quiz.teacherName || "", generatedAt: serverTimestamp(),
        studyGuide: result?.studyGuide || null,
      }, { merge: true });
      setInsights(payload);
      toast.success("AI analysis complete.");
    } catch (e) {
      toast.error(e.message || "Failed to generate insights.");
    } finally {
      setGenerating(false);
    }
  }

  // ─── early returns ────────────────────────────────────────────────────────

  usePageTitle(quiz?.title || "Responses");
  const selectedSubmission = submissions.find((s) => s.id === selectedStudentId);
  if (!user) return <Navigate to="/signin" replace />;
  if (loading) return <LoadingSpinner />;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  const tabs = [
    { id: "summary", label: "Summary" },
    { id: "question", label: "Question Drill" },
    { id: "individual", label: "Individual" },
    { id: "studyguide", label: rendered?.studyGuide ? "Study Guide" : "Study Guide" },
  ];

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <SiteHeader>
        <Link to="/dashboard" className="text-sm text-gray-500 transition-colors hover:text-gray-900">← Dashboard</Link>
      </SiteHeader>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">

        {/* Header */}
        <header className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Responses</p>
              <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">{quiz?.title}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {submissions.length} submissions · {quiz?.questions?.length || 0} questions
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleGenerate}
                disabled={generating || submissions.length === 0}
                className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
              >
                <FiRefreshCw className={generating ? "animate-spin" : ""} />
                {generating ? "Analyzing…" : insights ? "Re-analyze" : "Analyze with AI"}
              </button>
              <button
                onClick={() => exportCSV(submissions, quiz)}
                disabled={!submissions.length}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Export CSV
              </button>
            </div>
          </div>

          <nav className="-mb-px mt-4 flex gap-1 overflow-x-auto border-b border-gray-200 sm:gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                className={`shrink-0 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  viewMode === tab.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </header>

        {/* ── Tab content ── */}
        <AnimatePresence mode="wait">
          <motion.div key={viewMode} {...fadeUp} transition={{ duration: 0.18 }}>

            {/* ════════ SUMMARY ════════ */}
            {viewMode === "summary" && (
              <div className="space-y-5">

                {/* Stat cards */}
                <motion.div
                  className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                >
                  {[
                    { label: "Responses", value: summary.totalR },
                    {
                      label: "Class Average",
                      value: `${summary.totalQ > 0 ? ((summary.avgScore / summary.totalQ) * 100).toFixed(0) : 0}%`,
                      sub: `${summary.avgScore.toFixed(1)} / ${summary.totalQ} correct`,
                    },
                    { label: "Avg Time / Question", value: formatSeconds(summary.avgTime) },
                    { label: "Avg Confidence", value: `${summary.avgConf.toFixed(1)} / 5` },
                  ].map((card) => (
                    <motion.div key={card.label} variants={staggerItem} transition={{ duration: 0.15 }} className="rounded-lg border border-gray-200 bg-white p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{card.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-gray-900">{card.value}</p>
                      {card.sub && <p className="mt-0.5 text-xs text-gray-400">{card.sub}</p>}
                    </motion.div>
                  ))}
                </motion.div>

                {/* Class Pulse */}
                {submissions.length > 0 && (() => {
                  const accuracyScore = summary.totalQ > 0 ? (summary.avgScore / summary.totalQ) * 100 : 0;
                  const calibDiff = summary.totalQ > 0 ? Math.abs((summary.avgConf / 5) - (summary.avgScore / summary.totalQ)) * 100 : 0;
                  const calibBonus = Math.max(0, 100 - calibDiff * 1.5);
                  const outlierPenalty = stdAlerts.flagged.length * 8;
                  const pulse = Math.round(Math.max(0, Math.min(100, accuracyScore * 0.6 + calibBonus * 0.25 - outlierPenalty)));
                  const pulseLabel = pulse >= 75 ? "Ready to advance" : pulse >= 50 ? "On track, some gaps" : "Needs reteaching";
                  const pulseColor = pulse >= 75 ? "text-emerald-600" : pulse >= 50 ? "text-amber-600" : "text-red-600";
                  const pulseBg = pulse >= 75 ? "border-emerald-200 bg-emerald-50" : pulse >= 50 ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
                  const barColor = pulse >= 75 ? "bg-emerald-500" : pulse >= 50 ? "bg-amber-400" : "bg-red-500";
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`rounded-lg border p-6 ${pulseBg}`}
                    >
                      {/* Score row */}
                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Class Pulse</p>
                          <p className={`mt-1 text-5xl font-bold tabular-nums leading-none ${pulseColor}`}>{pulse}</p>
                        </div>
                        <div className="mb-1">
                          <p className="text-sm font-medium text-gray-700">{pulseLabel}</p>
                          <p className="mt-0.5 text-xs text-gray-400">Accuracy · Calibration · Outliers</p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/60">
                        <motion.div
                          className={`h-2 rounded-full ${barColor}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${pulse}%` }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-gray-400">
                        <span>0</span>
                        <span>100</span>
                      </div>

                      {/* AI Class Snapshot inline */}
                      {rendered?.classSummary && (
                        <div className="mt-5 space-y-4 border-t border-current/10 pt-5">
                          <p className="text-sm leading-relaxed text-gray-700">
                            {rendered.classSummary.headline}
                          </p>

                          {rendered.classSummary.readinessVerdict && (
                            <p className="text-xs text-gray-500">{rendered.classSummary.readinessVerdict}</p>
                          )}

                          {(rendered.classSummary.priorityConcepts || []).length > 0 && (
                            <div>
                              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Focus Areas</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(rendered.classSummary.priorityConcepts || []).map((c, i) => (
                                  <span key={i} className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">{c}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {(rendered.classSummary.reteachNow || []).length > 0 && (
                            <div>
                              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Reteach Now</p>
                              <div className="flex flex-col gap-1">
                                {(rendered.classSummary.reteachNow || []).map((r, i) => (
                                  <span key={i} className="flex items-center gap-1.5 text-xs text-red-700">
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                                    {r}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })()}

                {/* Score Distribution */}
                {submissions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                    className="rounded-lg border border-gray-200 bg-white p-5"
                  >
                    <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-700">Score Distribution</h3>
                    <p className="mb-4 text-xs text-gray-400">Bar height = number of students at that score. Darker bar = class average.</p>
                    <ScoreHistogram submissions={submissions} totalQuestions={quiz?.questions?.length || 0} />
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400">
                      <span>Mean: <strong className="text-gray-700">{stdAlerts.mean.toFixed(2)}</strong></span>
                      <span>Std Dev: <strong className="text-gray-700">{stdAlerts.stdDev.toFixed(2)}</strong></span>
                      <span>Threshold: <strong className="text-gray-700">{stdAlerts.threshold.toFixed(2)}</strong></span>
                    </div>
                  </motion.div>
                )}

                {/* Question Accuracy */}
                {questionStats.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.15 }}
                    className="rounded-lg border border-gray-200 bg-white p-5"
                  >
                    <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-700">Question Accuracy</h3>
                    <p className="mb-4 text-xs text-gray-400">Green ≥ 70% · Amber 40–69% · Red below 40%. Click label to drill in.</p>
                    <div className="space-y-3">
                      {questionStats.map((q) => {
                        const p = Math.round(q.correctRate);
                        return (
                          <div key={q.questionIndex} className="flex items-center gap-3">
                            <button
                              onClick={() => { setViewMode("question"); setSelectedQuestionIndex(q.questionIndex); }}
                              className="w-7 shrink-0 text-left text-xs font-semibold text-gray-400 hover:text-blue-600"
                            >
                              Q{q.questionIndex + 1}
                            </button>
                            <div className="flex-1 h-3 overflow-hidden rounded-full bg-gray-100">
                              <motion.div
                                className={`h-3 rounded-full ${barBg(p)}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${p}%` }}
                                transition={{ duration: 0.5, delay: q.questionIndex * 0.04 }}
                              />
                            </div>
                            <span className={`w-10 shrink-0 text-right text-sm font-semibold ${barText(p)}`}>{p}%</span>
                            <span className="hidden w-14 shrink-0 text-right text-xs text-gray-400 sm:block">{formatSeconds(q.avgTime)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}

                {/* Time + Confidence scatter — 2 col */}
                {submissions.length > 0 && (
                  <div className="grid gap-5 md:grid-cols-2">
                    {questionStats.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: 0.2 }}
                        className="rounded-lg border border-gray-200 bg-white p-5"
                      >
                        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-700">Avg Time per Question</h3>
                        <p className="mb-4 text-xs text-gray-400">Questions that took longest may indicate difficulty or confusion.</p>
                        <QuestionTimeChart questionStats={questionStats} />
                      </motion.div>
                    )}
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: 0.25 }}
                      className="rounded-lg border border-gray-200 bg-white p-5"
                    >
                      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-700">Confidence vs. Score</h3>
                      <p className="mb-4 text-xs text-gray-400">Top-left = underconfident. Bottom-right = overconfident. Each dot is a student.</p>
                      <ConfidenceScatterChart submissions={submissions} totalQuestions={quiz?.questions?.length || 0} />
                    </motion.div>
                  </div>
                )}

                {/* Toss-up questions (collapsible) */}
                {tossUpQuestions.length > 0 && (
                  <Collapsible title="Toss-Up Questions" badge={tossUpQuestions.length} defaultOpen>
                    <p className="mb-3 text-xs text-gray-400">Class split between correct and one wrong answer (both above 30%).</p>
                    <div className="space-y-2">
                      {tossUpQuestions.map((item) => (
                        <div key={item.questionIndex} className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-sm font-medium text-gray-800">Q{item.questionIndex + 1}: {item.questionText}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Correct: <span className="font-semibold text-emerald-700">{item.correctOptionText}</span> ({item.correctPct.toFixed(0)}%) ·{" "}
                            Top wrong: <span className="font-semibold text-red-600">{item.wrongOptionText}</span> ({item.wrongPct.toFixed(0)}%)
                          </p>
                        </div>
                      ))}
                    </div>
                  </Collapsible>
                )}

                {/* Struggle tags + Std dev — 2 col */}
                <div className="grid gap-5 md:grid-cols-2">
                  <Collapsible title="Struggle List" badge={`bottom ${struggleTags.length}`} defaultOpen>
                    <p className="mb-3 text-xs text-gray-400">Lowest-accuracy concept tags — reteach these first.</p>
                    <div className="space-y-2">
                      {struggleTags.map((tag) => (
                        <div key={tag.concept}>
                          <div className="mb-1 flex justify-between text-sm">
                            <span className="font-medium text-gray-800">{tag.concept}</span>
                            <span className={`font-semibold ${barText(tag.accuracy)}`}>{tag.accuracy.toFixed(0)}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            <div className={`h-2 rounded-full ${barBg(tag.accuracy)}`} style={{ width: `${tag.accuracy}%` }} />
                          </div>
                        </div>
                      ))}
                      {!struggleTags.length && <p className="text-xs text-gray-400">No tag data yet.</p>}
                    </div>
                  </Collapsible>

                  <Collapsible title="Outlier Alerts" badge={stdAlerts.flagged.length || undefined} defaultOpen>
                    <p className="mb-3 text-xs text-gray-400">Students below mean − 1.5 × std dev.</p>
                    <div className="space-y-2">
                      {stdAlerts.flagged.map((s) => (
                        <div key={s.id} className="rounded border border-red-200 bg-red-50 px-3 py-2">
                          <p className="text-sm font-medium text-gray-900">{s.studentName || "Unnamed"}</p>
                          <p className="text-xs text-red-600">Score {s.score} below threshold ({stdAlerts.threshold.toFixed(1)})</p>
                        </div>
                      ))}
                      {!stdAlerts.flagged.length && <p className="text-xs text-gray-400">No outliers detected.</p>}
                    </div>
                  </Collapsible>
                </div>

                {/* Click-happy (collapsible) */}
                <Collapsible title="Click-Happy Errors" badge={clickHappy.length || undefined}>
                  <p className="mb-3 text-xs text-gray-400">Incorrect answers submitted in under 3 seconds. More than 2 = flagged.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {clickHappy.map((row) => (
                      <div key={row.id} className={`rounded border px-3 py-2 ${row.flagged ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
                        <p className="text-sm font-medium text-gray-900">{row.studentName}</p>
                        <p className={`text-xs ${row.flagged ? "text-red-600" : "text-gray-500"}`}>{row.count} fast incorrect {row.flagged ? "· flagged" : ""}</p>
                      </div>
                    ))}
                    {!clickHappy.length && <p className="text-xs text-gray-400">None found.</p>}
                  </div>
                </Collapsible>

                {/* Class Matrix (collapsible, axes swapped) */}
                <Collapsible title="Class Matrix" defaultOpen={false}>
                  <p className="mb-3 text-xs text-gray-400">Rows = students · Columns = questions · ✓ correct · ✗ incorrect</p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 min-w-[140px] border border-gray-200 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-600">
                            Student
                          </th>
                          {(quiz?.questions || []).map((_, qi) => (
                            <th key={qi} className="border border-gray-200 bg-gray-50 px-4 py-3 text-center font-semibold text-gray-600 whitespace-nowrap">
                              Q{qi + 1}
                            </th>
                          ))}
                          <th className="border border-gray-200 bg-gray-50 px-4 py-3 text-center font-semibold text-gray-600">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submissions.map((s) => (
                          <tr key={s.id} className="hover:bg-gray-50">
                            <td className="sticky left-0 z-10 border border-gray-200 bg-white px-4 py-3 font-medium text-gray-800">
                              {s.studentName || "Unnamed"}
                            </td>
                            {(quiz?.questions || []).map((_, qi) => {
                              const a = s.answers?.[qi];
                              return (
                                <td key={qi} className={`border border-gray-200 px-4 py-3 text-center font-medium ${
                                  !a ? "text-gray-300" : a.isCorrect ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                                }`}>
                                  {!a ? "—" : a.isCorrect ? "✓" : "✗"}
                                </td>
                              );
                            })}
                            <td className="border border-gray-200 px-4 py-3 text-center font-semibold text-gray-700">
                              {s.score ?? 0}/{quiz?.questions?.length || 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Collapsible>
              </div>
            )}

            {/* ════════ QUESTION DRILL ════════ */}
            {viewMode === "question" && (
              <div className="rounded-lg border border-gray-200 bg-white p-5 sm:p-6">

                <div className="mb-5 flex justify-between flex-wrap items-center gap-2">
                

                  <div className="flex flex-wrap gap-1">
                    {(quiz?.questions || []).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedQuestionIndex(i)}
                        className={`rounded px-2.5 py-2 text-xs font-medium transition-colors ${i === selectedQuestionIndex ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}
                      >Q{i + 1}</button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedQuestionIndex((p) => Math.max(0, p - 1))}
                      disabled={selectedQuestionIndex <= 0}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-50"
                    >← Prev</button>
                    <button
                      onClick={() => setSelectedQuestionIndex((p) => Math.min((quiz?.questions?.length || 1) - 1, p + 1))}
                      disabled={selectedQuestionIndex >= (quiz?.questions?.length || 1) - 1}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-50"
                    >Next →</button>
                  </div>
                  
                </div>

                <AnimatePresence mode="wait">
                  <motion.div key={selectedQuestionIndex} {...fadeUp} transition={{ duration: 0.15 }}>
                    {questionStats[selectedQuestionIndex] ? (
                      <div className="space-y-5">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Question</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">{questionStats[selectedQuestionIndex].question.text}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {[
                            { label: "Correct Rate", value: `${questionStats[selectedQuestionIndex].correctRate.toFixed(0)}%` },
                            { label: "Avg Time", value: formatSeconds(questionStats[selectedQuestionIndex].avgTime) },
                            { label: "Avg Confidence", value: `${questionStats[selectedQuestionIndex].avgConf.toFixed(1)} / 5` },
                          ].map((s) => (
                            <div key={s.label} className="rounded border border-gray-200 bg-gray-50 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{s.label}</p>
                              <p className="mt-1 text-xl font-semibold text-gray-900">{s.value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Answer Distribution</p>
                          {questionStats[selectedQuestionIndex].question.options.map((opt, oi) => {
                            const count = questionStats[selectedQuestionIndex].optionCounts[oi] || 0;
                            const total = questionStats[selectedQuestionIndex].total || 1;
                            const w = (count / total) * 100;
                            const isCorrect = oi === questionStats[selectedQuestionIndex].question.correctAnswerIndex;
                            return (
                              <div key={oi}>
                                <div className="mb-1 flex justify-between text-sm">
                                  <span className={isCorrect ? "font-semibold text-emerald-700" : "text-gray-700"}>{opt}</span>
                                  <span className="text-gray-400">{count}</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                                  <div className={`h-2 rounded-full ${isCorrect ? "bg-emerald-500" : "bg-blue-400"}`} style={{ width: `${w}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {/* AI distractor analysis */}
                        {rendered?.questionInsights && (() => {
                          const qi = rendered.questionInsights.find(
                            (x) => x.questionLabel === `Q${selectedQuestionIndex + 1}`
                          );
                          if (!qi) return null;
                          return (
                            <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">AI Insight</p>
                              {qi.topMisconception && (
                                <p className="text-sm text-gray-700">
                                  <span className="font-medium text-gray-900">Top misconception:</span> {qi.topMisconception}
                                </p>
                              )}
                              {qi.distractorAnalysis && (
                                <p className="mt-1.5 text-sm text-gray-700">
                                  <span className="font-medium text-gray-900">Why the wrong answer looks right:</span> {qi.distractorAnalysis}
                                </p>
                              )}
                              {qi.teacherMove && (
                                <div className="mt-3 rounded border border-violet-200 bg-white px-3 py-2 text-xs text-gray-700">
                                  <span className="font-semibold text-violet-700">Teacher move:</span> {qi.teacherMove}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div className="grid gap-3 sm:grid-cols-2">
                          {[{ label: "ANSWERED CORRECTLY", color: "emerald", students: studentsByQuestion.correct }, { label: "ANSWERED INCORRECTLY", color: "red", students: studentsByQuestion.incorrect }].map(({ label, color, students }) => (
                            <div key={label} className={`rounded border border-${color}-200 bg-${color}-50 p-3`}>
                              <p className={`mb-2 text-xs font-semibold uppercase tracking-wide text-${color}-700`}>{label}</p>
                              <div className="flex flex-wrap gap-1">
                                {students.length === 0
                                  ? <span className={`text-xs text-${color}-700`}>None</span>
                                  : students.map((s) => (
                                    <span key={s.id} className={`rounded border border-${color}-200 bg-white px-2 py-0.5 text-xs text-${color}-700`}>{s.name}</span>
                                  ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : <p className="text-sm text-gray-400">No data yet.</p>}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}

            {/* ════════ INDIVIDUAL ════════ */}
            {viewMode === "individual" && (
              <div className="grid gap-4 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr]">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Students</p>
                  <div className="space-y-1">
                    {submissions.map((s) => {
                      const isSelected = selectedStudentId === s.id;
                      const scorePct = quiz?.questions?.length ? ((s.score || 0) / quiz.questions.length) * 100 : 0;
                      const dotColor = scorePct >= 70 ? "bg-emerald-500" : scorePct >= 40 ? "bg-amber-400" : "bg-red-500";
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSelectedStudentId(s.id)}
                          className={`w-full rounded px-3 py-2 text-left transition-colors ${isSelected ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-50"}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${isSelected ? "bg-blue-300" : dotColor}`} />
                            <p className="text-sm font-medium truncate">{s.studentName || "Unnamed"}</p>
                          </div>
                          <p className={`ml-4 text-xs ${isSelected ? "text-blue-200" : "text-gray-400"}`}>
                            {s.score ?? 0} / {quiz?.questions?.length || 0} · {Math.round(scorePct)}%
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-5">
                  {!selectedSubmission ? (
                    <p className="text-sm text-gray-400">Select a student.</p>
                  ) : (
                    <AnimatePresence mode="wait">
                      <motion.div key={selectedStudentId} {...fadeUp} transition={{ duration: 0.15 }} className="space-y-4">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Student</p>
                          <p className="mt-1 text-xl font-semibold text-gray-900">{selectedSubmission.studentName}</p>
                          <p className="text-sm text-gray-500">{selectedSubmission.score ?? 0} / {quiz?.questions?.length || 0} correct</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {percentileMap[selectedStudentId] != null && (
                              <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
                                {percentileMap[selectedStudentId]}th percentile
                              </span>
                            )}
                            {(() => {
                              const cal = getCalibration(selectedSubmission.answers);
                              if (!cal) return null;
                              const colors = { amber: "border-amber-200 bg-amber-50 text-amber-700", blue: "border-blue-200 bg-blue-50 text-blue-700", emerald: "border-emerald-200 bg-emerald-50 text-emerald-700" };
                              return (
                                <span className={`rounded border px-2 py-0.5 text-xs font-medium ${colors[cal.color]}`}>
                                  {cal.label}
                                </span>
                              );
                            })()}
                          </div>
                        </div>

                        {/* ── AI Student Plan ──────────────────────────────── */}
                        {(() => {
                          const aiPlan = (rendered?.studentActions || []).find(
                            (a) => a.studentName === selectedSubmission.studentName
                          );
                          if (!aiPlan) {
                            return (
                              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                                <p className="text-xs text-gray-400">No AI plan yet.</p>
                                <Link
                                  to={`/dashboard/quiz/${quizId}/insights`}
                                  className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                                >
                                  Generate AI Insights →
                                </Link>
                              </div>
                            );
                          }
                          return (
                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 space-y-4">
                              {/* Plan header */}
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">AI Student Plan</p>
                                <div className="flex flex-wrap gap-2">
                                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${aiPlan.needsSupport ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                                    {aiPlan.needsSupport ? "Needs Support" : "On Track"}
                                  </span>
                                  {aiPlan.riskLevel && (
                                    <span className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-600 capitalize">
                                      {aiPlan.riskLevel} risk
                                    </span>
                                  )}
                                  {aiPlan.readyToMoveOn != null && (
                                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${aiPlan.readyToMoveOn ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                      {aiPlan.readyToMoveOn ? "Ready to move on" : "Not ready"}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Conversation opener */}
                              {aiPlan.conversationStarter && (
                                <div className="rounded-lg border border-blue-200 bg-white px-4 py-3">
                                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-600">Say to this student:</p>
                                  <p className="text-sm italic leading-relaxed text-gray-700">"{aiPlan.conversationStarter}"</p>
                                </div>
                              )}

                              {/* Action plan */}
                              {aiPlan.actionPlan && (
                                <p className="text-sm leading-relaxed text-gray-700">{aiPlan.actionPlan}</p>
                              )}

                              {/* Misconceptions + Strengths */}
                              {(aiPlan.misconceptionProfile?.length > 0 || aiPlan.strengthAreas?.length > 0) && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {aiPlan.misconceptionProfile?.length > 0 && (
                                    <div>
                                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-600">Misconceptions</p>
                                      <div className="space-y-1">
                                        {aiPlan.misconceptionProfile.map((m, i) => (
                                          <div key={i} className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                                            <span className="mt-0.5 shrink-0">⚠</span> {m}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {aiPlan.strengthAreas?.length > 0 && (
                                    <div>
                                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600">Strengths</p>
                                      <div className="space-y-1">
                                        {aiPlan.strengthAreas.map((s, i) => (
                                          <div key={i} className="flex items-start gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
                                            <span className="mt-0.5 shrink-0">✓</span> {s}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Focus areas + priority questions */}
                              <div className="flex flex-wrap gap-4">
                                {aiPlan.focusAreas?.length > 0 && (
                                  <div>
                                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Focus Areas</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {aiPlan.focusAreas.map((area, i) => (
                                        <span key={i} className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-700">{area}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {aiPlan.priorityQuestions?.length > 0 && (
                                  <div>
                                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Review First</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {aiPlan.priorityQuestions.map((q, i) => (
                                        <span key={i} className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">{q}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* ── Performance flags ────────────────────────────── */}
                        <div className="grid gap-3 sm:grid-cols-3">
                          {[
                            { label: "Correct Answers", value: selectedSubmission.score ?? 0, sub: `out of ${quiz?.questions?.length || 0}`, color: "gray" },
                            { label: "High Conf. Wrong", value: (selectedSubmission.answers || []).filter((a) => !a.isCorrect && Number(a.confidence) >= 4).length, sub: "overconfident mistakes", color: "red" },
                            { label: "Low Conf. Correct", value: (selectedSubmission.answers || []).filter((a) => a.isCorrect && Number(a.confidence) <= 2).length, sub: "lucky guesses", color: "amber" },
                          ].map((c) => (
                            <div key={c.label} className="rounded border border-gray-200 bg-white p-4">
                              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{c.label}</p>
                              <p className={`mt-1 text-2xl font-semibold ${c.color === "red" && c.value > 0 ? "text-red-600" : c.color === "amber" && c.value > 0 ? "text-amber-600" : "text-gray-900"}`}>{c.value}</p>
                              <p className="mt-0.5 text-xs text-gray-400">{c.sub}</p>
                            </div>
                          ))}
                        </div>

                        {/* ── Question breakdown ───────────────────────────── */}
                        {(quiz?.questions || []).map((q, i) => {
                          const a = selectedSubmission.answers?.[i];
                          return (
                            <div key={i} className="rounded-lg border border-gray-200 bg-white p-5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Question {i + 1}</p>
                                <span className={`rounded px-2 py-0.5 text-xs font-medium ${a?.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                                  {a?.isCorrect ? "Correct" : "Incorrect"}
                                </span>
                              </div>
                              <p className="mt-2 font-medium text-gray-900">{q.text}</p>

                              <div className="mt-3 space-y-1.5">
                                {q.options.map((option, oi) => {
                                  const isChosen = a?.chosenIndex === oi;
                                  const isCorrect = q.correctAnswerIndex === oi;
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
                                        <span>
                                          <span className="mr-2 font-mono text-xs opacity-50">{String.fromCharCode(65 + oi)}</span>
                                          {option}
                                        </span>
                                        <span className="shrink-0 text-xs font-medium">
                                          {isCorrect && "✓ Correct"}
                                          {isChosen && !isCorrect && "Student's answer"}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="mt-3 flex flex-wrap gap-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                                <span><span className="font-medium text-gray-700">Time:</span> {formatSeconds(a?.timeSpentSeconds ?? 0)}</span>
                                <span><span className="font-medium text-gray-700">Confidence:</span> {a?.confidence ?? "—"}/5</span>
                              </div>
                              {q.aiRationale && (
                                <p className="mt-2 text-xs text-gray-400">
                                  <span className="font-medium">Rationale:</span> {q.aiRationale}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </motion.div>
                    </AnimatePresence>
                  )}
                </div>
              </div>
            )}

            {/* ════════ STUDY GUIDE ════════ */}
            {viewMode === "studyguide" && (
              <div>
                {!rendered?.studyGuide ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
                    <p className="font-semibold text-gray-800">No Study Guide Yet</p>
                    <p className="mt-1 text-sm text-gray-500 max-w-md mx-auto">
                      Generate an AI analysis to create a shareable study guide for your students.
                    </p>
                    <button
                      onClick={handleGenerate}
                      disabled={generating || !submissions.length}
                      className="mt-5 inline-flex items-center gap-2 rounded bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                    >
                      <FiRefreshCw className={generating ? "animate-spin" : ""} />
                      {generating ? "Analyzing…" : "Generate Study Guide"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="rounded-lg border border-gray-200 bg-white p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Study Guide</h3>
                          {rendered.studyGuide.title && (
                            <p className="mt-0.5 text-lg font-semibold text-gray-900">{rendered.studyGuide.title}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/studyguide/${quizId}`); toast.success("Link copied!"); }}
                            className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <FiShare2 /> Copy Link
                          </button>
                          <Link
                            to={`/studyguide/${quizId}`}
                            target="_blank"
                            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            Open →
                          </Link>
                        </div>
                      </div>
                      {rendered.studyGuide.overview && (
                        <p className="mt-3 text-sm leading-relaxed text-gray-600">{rendered.studyGuide.overview}</p>
                      )}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {(rendered.studyGuide.sections || []).map((section, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 bg-white p-5">
                          <p className="font-semibold text-gray-900">{section.topic}</p>
                          <p className="mt-1 text-xs text-gray-500">{section.whyItMatters}</p>
                          {(section.practiceTips || []).length > 0 && (
                            <ul className="mt-3 space-y-1.5">
                              {section.practiceTips.map((tip, j) => (
                                <li key={j} className="flex items-start gap-1.5 text-xs text-gray-600">
                                  <span className="mt-0.5 shrink-0 text-emerald-500">✓</span> {tip}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Student Plans tab removed — content merged into Individual tab */}
            {false && (
              <div>
                {!rendered ? (
                  <div />
                ) : (
                  <div className="grid gap-4 md:grid-cols-[260px_1fr]">
                    {/* Student list */}
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Students</p>
                      <p className="mb-3 px-2 text-xs text-gray-400">Sorted by need — highest risk first</p>
                      <div className="space-y-1">
                        {studentPlanData.map((s) => {
                          const isSelected = (selectedPlanStudentId || studentPlanData[0]?.id) === s.id;
                          return (
                            <button
                              key={s.id}
                              onClick={() => setSelectedPlanStudentId(s.id)}
                              className={`w-full rounded px-3 py-2.5 text-left transition-colors ${isSelected ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-50"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium truncate">{s.studentName || "Unnamed"}</p>
                                {s.needsSupport && (
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${isSelected ? "bg-red-500 text-white" : "bg-red-100 text-red-600"}`}>
                                    {s.riskLevel || "!"}
                                  </span>
                                )}
                              </div>
                              <p className={`text-xs ${isSelected ? "text-blue-200" : "text-gray-400"}`}>
                                {s.score ?? 0} / {quiz?.questions?.length || 0} · {s.needsSupport ? "Needs support" : "On track"}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Student detail */}
                    <div className="min-w-0">
                      {selectedPlanStudent ? (
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={selectedPlanStudent.id}
                            {...fadeUp}
                            transition={{ duration: 0.15 }}
                            className="space-y-4"
                          >
                            {/* Header */}
                            <div className="rounded-lg border border-gray-200 bg-white p-5">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Student</p>
                                  <p className="mt-0.5 text-2xl font-semibold text-gray-900">{selectedPlanStudent.studentName || "Unnamed"}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <div className="rounded border border-gray-200 bg-gray-50 px-4 py-2 text-center">
                                    <p className="text-xl font-bold text-gray-900">{selectedPlanStudent.score ?? 0}</p>
                                    <p className="text-xs text-gray-400">/ {quiz?.questions?.length || 0}</p>
                                  </div>
                                  <div className="rounded border border-gray-200 bg-gray-50 px-4 py-2 text-center">
                                    <p className="text-xl font-bold text-gray-900">
                                      {quiz?.questions?.length ? Math.round(((selectedPlanStudent.score || 0) / quiz.questions.length) * 100) : 0}%
                                    </p>
                                    <p className="text-xs text-gray-400">correct</p>
                                  </div>
                                  <div className={`rounded border px-4 py-2 text-center ${selectedPlanStudent.needsSupport ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                                    <p className={`text-sm font-bold ${selectedPlanStudent.needsSupport ? "text-red-700" : "text-emerald-700"}`}>
                                      {selectedPlanStudent.needsSupport ? "Needs Support" : "On Track"}
                                    </p>
                                    {selectedPlanStudent.riskLevel && (
                                      <p className="text-xs capitalize text-gray-400">{selectedPlanStudent.riskLevel} risk</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* AI Action Plan */}
                            {selectedPlanStudent.actionPlan && (
                              <div className="rounded-lg border border-gray-200 bg-white p-5">
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">AI Action Plan</h3>
                                <p className="text-sm leading-relaxed text-gray-700">{selectedPlanStudent.actionPlan}</p>
                                {selectedPlanStudent.focusAreas.length > 0 && (
                                  <div className="mt-4">
                                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Focus Areas</p>
                                    <div className="flex flex-wrap gap-2">
                                      {selectedPlanStudent.focusAreas.map((area, i) => (
                                        <span key={i} className="rounded border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{area}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Performance flags */}
                            <div className="grid gap-3 sm:grid-cols-3">
                              {[
                                {
                                  label: "Correct Answers",
                                  value: selectedPlanStudent.score ?? 0,
                                  sub: `out of ${quiz?.questions?.length || 0}`,
                                  color: "gray",
                                },
                                {
                                  label: "High Conf. Wrong",
                                  value: (selectedPlanStudent.answers || []).filter((a) => !a.isCorrect && Number(a.confidence) >= 4).length,
                                  sub: "overconfident mistakes",
                                  color: "red",
                                },
                                {
                                  label: "Low Conf. Correct",
                                  value: (selectedPlanStudent.answers || []).filter((a) => a.isCorrect && Number(a.confidence) <= 2).length,
                                  sub: "lucky guesses",
                                  color: "amber",
                                },
                              ].map((c) => (
                                <div key={c.label} className="rounded border border-gray-200 bg-white p-4">
                                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{c.label}</p>
                                  <p className={`mt-1 text-2xl font-semibold ${c.color === "red" && c.value > 0 ? "text-red-600" : c.color === "amber" && c.value > 0 ? "text-amber-600" : "text-gray-900"}`}>{c.value}</p>
                                  <p className="mt-0.5 text-xs text-gray-400">{c.sub}</p>
                                </div>
                              ))}
                            </div>

                            {/* Question-by-question */}
                            <div className="rounded-lg border border-gray-200 bg-white p-5">
                              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-700">Question Breakdown</h3>
                              <div className="space-y-3">
                                {(quiz?.questions || []).map((q, i) => {
                                  const a = selectedPlanStudent.answers?.[i];
                                  return (
                                    <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Question {i + 1}</p>
                                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${a?.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                                          {a?.isCorrect ? "Correct" : "Incorrect"}
                                        </span>
                                      </div>
                                      <p className="mt-2 font-medium text-gray-900">{q.text}</p>

                                      <div className="mt-3 space-y-1.5">
                                        {q.options.map((option, oi) => {
                                          const isChosen = a?.chosenIndex === oi;
                                          const isCorrect = q.correctAnswerIndex === oi;
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
                                                <span>
                                                  <span className="mr-2 font-mono text-xs opacity-50">{String.fromCharCode(65 + oi)}</span>
                                                  {option}
                                                </span>
                                                <span className="shrink-0 text-xs font-medium">
                                                  {isCorrect && "✓ Correct"}
                                                  {isChosen && !isCorrect && "Student's answer"}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>

                                      <div className="mt-3 flex flex-wrap gap-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                                        <span><span className="font-medium text-gray-700">Time:</span> {formatSeconds(a?.timeSpentSeconds ?? 0)}</span>
                                        <span><span className="font-medium text-gray-700">Confidence:</span> {a?.confidence ?? "—"}/5</span>
                                      </div>
                                      {q.aiRationale && (
                                        <p className="mt-2 text-xs text-gray-400">
                                          <span className="font-medium">Rationale:</span> {q.aiRationale}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </motion.div>
                        </AnimatePresence>
                      ) : (
                        <p className="text-sm text-gray-400">Select a student to view their plan.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

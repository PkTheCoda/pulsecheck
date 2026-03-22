import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import { db } from "../lib/firebase";

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

/** SVG normal-distribution dot plot */
function ScoreDistributionChart({ submissions, totalQuestions }) {
  const scores = useMemo(() => submissions.map((s) => s.score || 0), [submissions]);
  if (!scores.length || !totalQuestions) return null;

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  // Stack students with same score
  const stacks = {};
  submissions.forEach((s) => {
    const sc = s.score || 0;
    if (!stacks[sc]) stacks[sc] = [];
    stacks[sc].push(s.studentName || "?");
  });
  const maxStack = Math.max(...Object.values(stacks).map((a) => a.length));

  const W = 640, DOT_R = 10, DOT_GAP = 3;
  const PAD = { top: 24, right: 28, bottom: 44, left: 28 };
  const innerW = W - PAD.left - PAD.right;
  // Height: enough for the tallest stack
  const dotAreaH = maxStack * (DOT_R * 2 + DOT_GAP) + DOT_R;
  const H = PAD.top + Math.max(dotAreaH, 80) + PAD.bottom;

  const xScale = (sc) => PAD.left + (sc / totalQuestions) * innerW;
  // Dots stack upward from the axis
  const yForDot = (stackIdx) => H - PAD.bottom - stackIdx * (DOT_R * 2 + DOT_GAP) - DOT_R;

  // Bell curve
  function pdf(x) {
    if (stdDev < 0.01) return 0;
    return Math.exp(-0.5 * ((x - mean) / stdDev) ** 2);
  }
  const steps = 120;
  const curvePts = Array.from({ length: steps + 1 }, (_, i) => {
    const x = (i / steps) * totalQuestions;
    return { x, y: pdf(x) };
  });
  const maxPDF = Math.max(...curvePts.map((p) => p.y), 0.001);
  // Map PDF y to SVG y: curve fills upper portion above dot area
  const curveAreaH = Math.max(dotAreaH * 0.5, 40);
  const yCurve = (y) => PAD.top + curveAreaH - (y / maxPDF) * curveAreaH;

  const pathD = curvePts.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(1)} ${yCurve(p.y).toFixed(1)}`).join(" ");
  const fillD = `${pathD} L ${xScale(totalQuestions).toFixed(1)} ${yCurve(0).toFixed(1)} L ${xScale(0).toFixed(1)} ${yCurve(0).toFixed(1)} Z`;

  // Tick marks (integer scores)
  const ticks = Array.from({ length: totalQuestions + 1 }, (_, i) => i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: "visible" }}>
      {/* Bell curve fill */}
      {stdDev > 0.01 && (
        <>
          <path d={fillD} fill="#e0e7ff" fillOpacity="0.6" />
          <path d={pathD} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.5" />
        </>
      )}

      {/* Mean dashed line */}
      {stdDev > 0 && (
        <>
          <line
            x1={xScale(mean).toFixed(1)} y1={PAD.top}
            x2={xScale(mean).toFixed(1)} y2={H - PAD.bottom}
            stroke="#9ca3af" strokeWidth="1" strokeDasharray="4,3"
          />
          <text x={xScale(mean).toFixed(1)} y={PAD.top - 6} textAnchor="middle" fontSize="10" fill="#9ca3af">
            avg {mean.toFixed(1)}
          </text>
        </>
      )}

      {/* X axis */}
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="#e5e7eb" strokeWidth="1" />
      {ticks.map((sc) => (
        <g key={sc}>
          <line x1={xScale(sc)} y1={H - PAD.bottom} x2={xScale(sc)} y2={H - PAD.bottom + 4} stroke="#d1d5db" strokeWidth="1" />
          <text x={xScale(sc)} y={H - PAD.bottom + 15} textAnchor="middle" fontSize="10" fill="#9ca3af">{sc}</text>
        </g>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#9ca3af">Score</text>

      {/* Student dots — stacked per score */}
      {Object.entries(stacks).map(([sc, names]) =>
        names.map((name, stackIdx) => {
          const cx = xScale(Number(sc));
          const cy = yForDot(stackIdx);
          return (
            <g key={`${sc}-${stackIdx}`}>
              <circle cx={cx} cy={cy} r={DOT_R} fill="#3b82f6" stroke="white" strokeWidth="1.5" />
              <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="7.5" fill="white" fontWeight="600">
                {name.slice(0, 4)}
              </text>
              {stackIdx === 0 && (
                <text x={cx} y={H - PAD.bottom + 28} textAnchor="middle" fontSize="9" fill="#6b7280">
                  {sc}
                </text>
              )}
            </g>
          );
        })
      )}
    </svg>
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
  const [selectedPlanStudentId, setSelectedPlanStudentId] = useState(null);

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

  // ── Student Plan data (joins submissions + AI insights) ──────────────────

  const rendered = insights?.insights;

  const studentPlanData = useMemo(() => {
    const aiActions = rendered?.studentActions || [];
    const riskOrder = { high: 0, medium: 1, low: 2 };
    return submissions.map((s) => {
      const ai = aiActions.find((a) => a.studentName === s.studentName);
      return { ...s, ai: ai || null, needsSupport: ai?.needsSupport || false, riskLevel: ai?.riskLevel || null, focusAreas: ai?.focusAreas || [], actionPlan: ai?.actionPlan || null };
    }).sort((a, b) => {
      if (a.needsSupport && !b.needsSupport) return -1;
      if (!a.needsSupport && b.needsSupport) return 1;
      const ra = riskOrder[a.riskLevel] ?? 3, rb = riskOrder[b.riskLevel] ?? 3;
      if (ra !== rb) return ra - rb;
      return (a.score || 0) - (b.score || 0);
    });
  }, [submissions, rendered]);

  const selectedPlanStudent = studentPlanData.find((s) => s.id === selectedPlanStudentId) || studentPlanData[0];

  // ─── early returns ────────────────────────────────────────────────────────

  const selectedSubmission = submissions.find((s) => s.id === selectedStudentId);
  if (!user) return <Navigate to="/signin" replace />;
  if (loading) return <LoadingSpinner />;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  const tabs = [
    { id: "summary", label: "Summary" },
    { id: "question", label: "Question Drill" },
    { id: "individual", label: "Individual" },
    { id: "studentplan", label: "Student Plans" },
  ];

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
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
              <Link to={`/dashboard/quiz/${quizId}/insights`} className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">AI Insights</Link>
              <Link to="/dashboard" className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">← Dashboard</Link>
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

                {/* Score Distribution */}
                {submissions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                    className="rounded-lg border border-gray-200 bg-white p-5"
                  >
                    <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-700">Score Distribution</h3>
                    <p className="mb-4 text-xs text-gray-400">Each dot is a student. Hover for name. Bell curve shows class distribution.</p>
                    <div className="overflow-x-auto">
                      <ScoreDistributionChart submissions={submissions} totalQuestions={quiz?.questions?.length || 0} />
                    </div>
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
                <div className="mb-5 flex flex-wrap items-center gap-2">
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
                  <div className="flex flex-wrap gap-1">
                    {(quiz?.questions || []).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedQuestionIndex(i)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${i === selectedQuestionIndex ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}
                      >Q{i + 1}</button>
                    ))}
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
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[{ label: "Got It Right", color: "emerald", students: studentsByQuestion.correct }, { label: "Got It Wrong", color: "red", students: studentsByQuestion.incorrect }].map(({ label, color, students }) => (
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
                    {submissions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedStudentId(s.id)}
                        className={`w-full rounded px-3 py-2 text-left transition-colors ${selectedStudentId === s.id ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-50"}`}
                      >
                        <p className="text-sm font-medium">{s.studentName || "Unnamed"}</p>
                        <p className={`text-xs ${selectedStudentId === s.id ? "text-blue-200" : "text-gray-400"}`}>
                          {s.score ?? 0} / {quiz?.questions?.length || 0}
                        </p>
                      </button>
                    ))}
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
                        </div>
                        {(quiz?.questions || []).map((q, i) => {
                          const a = selectedSubmission.answers?.[i];
                          const chosen = typeof a?.chosenIndex === "number" ? q.options[a.chosenIndex] : "No answer";
                          const correct = q.options[q.correctAnswerIndex];
                          return (
                            <div key={i} className="rounded border border-gray-200 bg-gray-50 p-4">
                              <div className="flex items-start justify-between gap-2">
                                <p className="font-medium text-gray-900">{i + 1}. {q.text}</p>
                                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${a?.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                                  {a?.isCorrect ? "Correct" : "Incorrect"}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-gray-600">Selected: <span className="font-medium text-gray-800">{chosen}</span></p>
                              {!a?.isCorrect && <p className="text-sm text-gray-600">Correct: <span className="font-medium text-emerald-700">{correct}</span></p>}
                              <p className="mt-1 text-xs text-gray-400">Confidence: {a?.confidence ?? "—"}/5 · Time: {formatSeconds(a?.timeSpentSeconds ?? 0)}</p>
                            </div>
                          );
                        })}
                      </motion.div>
                    </AnimatePresence>
                  )}
                </div>
              </div>
            )}

            {/* ════════ STUDENT PLANS ════════ */}
            {viewMode === "studentplan" && (
              <div>
                {!rendered ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
                    <p className="font-semibold text-gray-800">AI Insights Not Generated</p>
                    <p className="mt-1 text-sm text-gray-500">Generate AI insights first to see per-student action plans sorted by who needs the most support.</p>
                    <Link
                      to={`/dashboard/quiz/${quizId}/insights`}
                      className="mt-4 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Go to AI Insights →
                    </Link>
                  </div>
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
                                  const chosen = typeof a?.chosenIndex === "number" ? q.options[a.chosenIndex] : "Not answered";
                                  const correct = q.options[q.correctAnswerIndex];
                                  return (
                                    <div key={i} className={`rounded border p-4 ${a?.isCorrect ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                                      <div className="flex items-start justify-between gap-2">
                                        <p className="font-medium text-gray-900">{i + 1}. {q.text}</p>
                                        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${a?.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                                          {a?.isCorrect ? "Correct" : "Incorrect"}
                                        </span>
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                                        <span className="text-gray-600">
                                          Selected: <span className={`font-medium ${a?.isCorrect ? "text-emerald-800" : "text-red-700"}`}>{chosen}</span>
                                        </span>
                                        {!a?.isCorrect && (
                                          <span className="text-gray-600">
                                            Answer: <span className="font-medium text-emerald-800">{correct}</span>
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-gray-500">
                                        <span>Confidence: {a?.confidence ?? "—"}/5</span>
                                        <span>Time: {formatSeconds(a?.timeSpentSeconds ?? 0)}</span>
                                      </div>
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

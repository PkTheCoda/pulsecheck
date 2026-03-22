import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  doc, getDoc, onSnapshot, query, collection, where, setDoc, serverTimestamp,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { FiAlertTriangle, FiBookOpen, FiCheck, FiRefreshCw, FiShare2, FiZap } from "react-icons/fi";
import { db } from "../lib/firebase";
import { generateInsightsWithGemini } from "../lib/gemini";

function barBg(p) {
  if (p >= 70) return "bg-emerald-500";
  if (p >= 40) return "bg-amber-400";
  return "bg-red-500";
}
function barText(p) {
  if (p >= 70) return "text-emerald-600";
  if (p >= 40) return "text-amber-600";
  return "text-red-600";
}

export default function TeacherInsightsPage({ user }) {
  const { quizId } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const geminiApiKey = import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";

  useEffect(() => {
    async function load() {
      if (!quizId || !user) return;
      try {
        const snap = await getDoc(doc(db, "quizzes", quizId));
        if (!snap.exists()) { setError("Quiz not found."); setLoading(false); return; }
        const q = { id: snap.id, ...snap.data() };
        if (q.ownerId !== user.uid) { setError("Access denied."); setLoading(false); return; }
        setQuiz(q);
        const aiSnap = await getDoc(doc(db, "aiInsights", quizId));
        if (aiSnap.exists()) setInsights(aiSnap.data());
      } catch (e) {
        setError(e.message || "Failed to load.");
      }
    }
    load();
  }, [quizId, user]);

  useEffect(() => {
    if (!quizId || !user) return undefined;
    const q = query(collection(db, "submissions"), where("quizId", "==", quizId));
    const unsub = onSnapshot(
      q,
      (snap) => { setSubmissions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); }
    );
    return () => unsub();
  }, [quizId, user]);

  const analyticsPayload = useMemo(() => {
    const questionAnalytics = (quiz?.questions || []).map((question, index) => {
      const answers = submissions.map((s) => s.answers?.[index]).filter(Boolean);
      const correct = answers.filter((a) => a.isCorrect).length;
      const optionCounts = question.options.map((_, oi) => answers.filter((a) => a.chosenIndex === oi).length);
      return {
        questionLabel: `Q${index + 1}`,
        questionText: question.text,
        concept: question?.tags?.concept || "Uncategorized",
        correctRate: answers.length ? correct / answers.length : 0,
        avgConfidence: answers.length ? answers.reduce((acc, a) => acc + (a.confidence || 0), 0) / answers.length : 0,
        avgTime: answers.length ? answers.reduce((acc, a) => acc + (a.timeSpentSeconds || 0), 0) / answers.length : 0,
        optionCounts,
      };
    });
    const studentAnalytics = submissions.map((s) => ({
      studentName: s.studentName || "Unnamed",
      score: s.score || 0,
      lowConfidenceCorrect: (s.answers || []).filter((a) => a.isCorrect && Number(a.confidence) <= 2).length,
      highConfidenceWrong: (s.answers || []).filter((a) => !a.isCorrect && Number(a.confidence) >= 4).length,
      fastWrong: (s.answers || []).filter((a) => !a.isCorrect && Number(a.timeSpentSeconds) < 3).length,
    }));
    return {
      quizTitle: quiz?.title || "",
      teacherName: quiz?.teacherName || "",
      responseCount: submissions.length,
      questionAnalytics,
      studentAnalytics,
    };
  }, [quiz, submissions]);

  const classStats = useMemo(() => {
    const { questionAnalytics, studentAnalytics } = analyticsPayload;
    const totalQ = quiz?.questions?.length || 1;
    const avgScore = studentAnalytics.length
      ? studentAnalytics.reduce((acc, s) => acc + s.score, 0) / studentAnalytics.length : 0;
    const avgScorePct = (avgScore / totalQ) * 100;
    const avgConf = questionAnalytics.length
      ? questionAnalytics.reduce((acc, q) => acc + q.avgConfidence, 0) / questionAnalytics.length : 0;
    const confNorm = ((avgConf - 1) / 4) * 100;

    let sentiment;
    if (confNorm > 55 && avgScorePct > 55) {
      sentiment = { label: "Well-Calibrated", desc: "Students feel confident and are scoring well — self-assessment matches reality.", tip: "Celebrate progress and introduce stretch challenges." };
    } else if (confNorm > 55 && avgScorePct <= 55) {
      sentiment = { label: "Overconfident", desc: "Students feel more certain than scores justify — a common learning gap indicator.", tip: "Use targeted questioning to surface misconceptions before moving on." };
    } else if (confNorm <= 55 && avgScorePct > 55) {
      sentiment = { label: "Underconfident", desc: "Students are performing better than they feel.", tip: "Explicitly celebrate correct answers and validate students verbally." };
    } else {
      sentiment = { label: "Needs Support", desc: "Students are struggling and are aware of it — a critical intervention moment.", tip: "Pause, reteach core concepts, and offer small-group support." };
    }

    return { avgScore, avgScorePct, avgConf, sentiment };
  }, [analyticsPayload, quiz]);

  const signature = useMemo(() => {
    const latest = submissions.reduce((max, s) => Math.max(max, s?.createdAt?.seconds || 0), 0);
    return `${quiz?.updatedAt?.seconds || 0}-${submissions.length}-${latest}`;
  }, [quiz, submissions]);

  async function handleGenerate() {
    if (!geminiApiKey) { toast.error("Missing GEMINI_API_KEY in env."); return; }
    if (!quiz) return;
    try {
      setGenerating(true);
      const result = await generateInsightsWithGemini({
        apiKey: geminiApiKey,
        quizTitle: quiz.title,
        teacherName: quiz.teacherName || user?.displayName || "Teacher",
        analyticsPayload,
      });
      const payload = { ownerId: quiz.ownerId, quizId, signature, generatedAt: serverTimestamp(), insights: result };
      await setDoc(doc(db, "aiInsights", quizId), payload, { merge: true });
      await setDoc(doc(db, "studyGuides", quizId), {
        ownerId: quiz.ownerId, quizId, quizTitle: quiz.title,
        teacherName: quiz.teacherName || "", generatedAt: serverTimestamp(),
        studyGuide: result?.studyGuide || null,
      }, { merge: true });
      setInsights(payload);
      toast.success("AI insights generated.");
    } catch (e) {
      toast.error(e.message || "Failed to generate insights.");
    } finally {
      setGenerating(false);
    }
  }

  if (!user) return <Navigate to="/signin" replace />;
  if (loading) return <div className="p-6 text-sm text-gray-600">Loading insights...</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  const studyGuideLink = `${window.location.origin}/studyguide/${quizId}`;
  const rendered = insights?.insights;
  const atRisk = (rendered?.studentActions || []).filter((s) => s.needsSupport).length;

  const scoreColor = classStats.avgScorePct >= 70 ? "text-emerald-600"
    : classStats.avgScorePct >= 40 ? "text-amber-600" : "text-red-600";

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* Header */}
        <header className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">AI Insights</p>
              <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">{quiz?.title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                <span>{submissions.length} responses · {quiz?.questions?.length || 0} questions</span>
                {insights?.generatedAt && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    <FiCheck /> AI insights ready
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/dashboard"
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                ← Dashboard
              </Link>
              <Link
                to={`/dashboard/quiz/${quizId}/responses`}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Responses
              </Link>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
              >
                <FiRefreshCw className={generating ? "animate-spin" : ""} />
                {generating ? "Analyzing…" : insights ? "Re-analyze" : "Analyze Class"}
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-5">

          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Students</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{submissions.length}</p>
              <p className="mt-0.5 text-xs text-gray-400">total responses</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Class Average</p>
              <p className={`mt-2 text-2xl font-semibold ${scoreColor}`}>
                {classStats.avgScorePct.toFixed(0)}%
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {classStats.avgScore.toFixed(1)} / {quiz?.questions?.length || 0} correct
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">At Risk</p>
              <p className={`mt-2 text-2xl font-semibold ${rendered && atRisk > 0 ? "text-red-600" : "text-gray-900"}`}>
                {rendered ? atRisk : "—"}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {rendered ? (atRisk === 0 ? "all on track" : "need intervention") : "run analysis to see"}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Avg Confidence</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {classStats.avgConf > 0 ? `${classStats.avgConf.toFixed(1)} / 5` : "—"}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{classStats.sentiment.label}</p>
            </div>
          </div>

          {/* Per-question performance chart */}
          {analyticsPayload.questionAnalytics.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                    Question Performance
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Green ≥ 70% · Amber 40–69% · Red below 40%
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-8 rounded-full bg-gray-300" /> Accuracy
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-8 rounded-full bg-blue-300" /> Confidence
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {analyticsPayload.questionAnalytics.map((q) => {
                  const p = Math.round(q.correctRate * 100);
                  const confPct = Math.round(((q.avgConfidence || 1) - 1) / 4 * 100);
                  return (
                    <div key={q.questionLabel} className="flex items-center gap-3">
                      <span className="w-7 shrink-0 text-xs font-semibold text-gray-400">{q.questionLabel}</span>
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 truncate text-xs text-gray-400">{q.concept}</p>
                        <div className="flex gap-1.5">
                          <div className="flex-1 h-3 overflow-hidden rounded-full bg-gray-100">
                            <div className={`h-3 rounded-full ${barBg(p)} transition-all duration-500`} style={{ width: `${p}%` }} />
                          </div>
                          <div className="w-20 shrink-0 h-3 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-3 rounded-full bg-blue-300 transition-all duration-500" style={{ width: `${confPct}%` }} />
                          </div>
                        </div>
                      </div>
                      <span className={`w-10 shrink-0 text-right text-sm font-semibold ${barText(p)}`}>{p}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Class Sentiment */}
          {submissions.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
                Class Sentiment
              </h3>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-sm font-semibold text-gray-700">
                      {classStats.sentiment.label}
                    </span>
                    <span className="text-xs text-gray-400">
                      Confidence {classStats.avgConf.toFixed(1)}/5 vs Score {classStats.avgScorePct.toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{classStats.sentiment.desc}</p>
                  <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    💡 {classStats.sentiment.tip}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* No AI CTA */}
          {!rendered && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
              <FiZap className="mx-auto mb-3 text-3xl text-gray-400" />
              <p className="font-semibold text-gray-900">No AI Analysis Yet</p>
              <p className="mt-1 text-sm text-gray-500 max-w-md mx-auto">
                Click Analyze Class to get per-student action plans, question-level teaching recommendations, and a shareable study guide.
              </p>
              <button
                onClick={handleGenerate}
                disabled={generating || submissions.length === 0}
                className="mt-5 inline-flex items-center gap-2 rounded bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
              >
                <FiZap />
                {generating ? "Analyzing…" : "Analyze Class Now"}
              </button>
              {submissions.length === 0 && (
                <p className="mt-2 text-xs text-gray-400">Waiting for student submissions first.</p>
              )}
            </div>
          )}

          {rendered && (
            <>
              {/* AI Class Snapshot */}
              <div className="rounded-lg border border-gray-200 bg-white p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
                  AI Class Snapshot
                </h3>
                <p className="border-l-2 border-blue-500 pl-4 text-base font-medium text-gray-800">
                  {rendered?.classSummary?.headline}
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Priority Concepts</p>
                    <div className="flex flex-wrap gap-2">
                      {(rendered?.classSummary?.priorityConcepts || []).map((item, i) => (
                        <span key={i} className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Reteach Now</p>
                    <div className="space-y-1.5">
                      {(rendered?.classSummary?.reteachNow || []).map((item, i) => (
                        <div key={i} className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                          <FiAlertTriangle className="mt-0.5 shrink-0" /> {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Sentiment */}
              {rendered?.classSentiment && (
                <div className="rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
                    AI Sentiment Analysis
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-sm font-semibold text-gray-700">
                      {rendered.classSentiment.label}
                    </span>
                    <p className="flex-1 text-sm text-gray-600">{rendered.classSentiment.headline}</p>
                  </div>
                  {rendered.classSentiment.recommendation && (
                    <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                      💡 <span className="font-medium">Next step:</span> {rendered.classSentiment.recommendation}
                    </div>
                  )}
                </div>
              )}

              {/* Student Action Plans */}
              {(rendered?.studentActions || []).length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                      Student Action Plans
                    </h3>
                    {atRisk > 0 && (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                        {atRisk} need support
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(rendered?.studentActions || []).map((row, i) => (
                      <div
                        key={i}
                        className={`rounded border p-4 ${
                          row.needsSupport
                            ? "border-red-200 bg-red-50"
                            : "border-emerald-200 bg-emerald-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-gray-900">{row.studentName}</p>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                              row.needsSupport ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                            }`}>
                              {row.needsSupport ? "Needs Support" : "On Track"}
                            </span>
                            {row.riskLevel && (
                              <span className="text-xs capitalize text-gray-400">{row.riskLevel} risk</span>
                            )}
                          </div>
                        </div>
                        {(row.focusAreas || []).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {row.focusAreas.map((area, j) => (
                              <span key={j} className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600">
                                {area}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="mt-2 text-xs leading-relaxed text-gray-700">{row.actionPlan}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Question Insights */}
              {(rendered?.questionInsights || []).length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-700">
                    Per-Question Teaching Insights
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {rendered.questionInsights.map((qi, i) => (
                      <div key={i} className="rounded border border-gray-200 bg-gray-50 p-4">
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          {qi.questionLabel}
                        </span>
                        <div className="mt-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Issue</p>
                          <p className="mt-1 text-sm text-gray-700">{qi.issue}</p>
                        </div>
                        <div className="mt-3 rounded border border-gray-200 bg-white px-3 py-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-blue-600">Teacher Move</p>
                          <p className="mt-1 text-xs leading-relaxed text-gray-700">{qi.teacherMove}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Study Guide */}
              <div className="rounded-lg border border-gray-200 bg-white p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Shareable Study Guide</h3>
                    {rendered?.studyGuide?.title && (
                      <p className="mt-0.5 text-xs text-gray-500">{rendered.studyGuide.title}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      onClick={() => { navigator.clipboard.writeText(studyGuideLink); toast.success("Link copied!"); }}
                    >
                      <FiShare2 /> Copy Link
                    </button>
                    <Link
                      to={`/studyguide/${quizId}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      <FiBookOpen /> Open Guide
                    </Link>
                  </div>
                </div>
                {rendered?.studyGuide?.overview && (
                  <p className="text-sm leading-relaxed text-gray-700">{rendered.studyGuide.overview}</p>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(rendered?.studyGuide?.sections || []).map((section, i) => (
                    <div key={i} className="rounded border border-gray-200 bg-gray-50 p-4">
                      <p className="font-semibold text-gray-900">{section.topic}</p>
                      <p className="mt-1 text-xs leading-relaxed text-gray-600">{section.whyItMatters}</p>
                      {(section.practiceTips || []).length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {section.practiceTips.map((tip, j) => (
                            <li key={j} className="flex items-start gap-1.5 text-xs text-gray-600">
                              <FiCheck className="mt-0.5 shrink-0 text-emerald-500" /> {tip}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

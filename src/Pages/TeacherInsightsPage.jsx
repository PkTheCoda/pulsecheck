import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { doc, getDoc, onSnapshot, query, collection, where, setDoc, serverTimestamp } from "firebase/firestore";
import toast from "react-hot-toast";
import { FiBookOpen, FiRefreshCw, FiShare2, FiZap } from "react-icons/fi";
import { db } from "../lib/firebase";
import { generateInsightsWithGemini } from "../lib/gemini";

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
    async function loadQuizAndCachedInsights() {
      if (!quizId || !user) return;
      try {
        const quizSnap = await getDoc(doc(db, "quizzes", quizId));
        if (!quizSnap.exists()) {
          setError("Quiz not found.");
          setLoading(false);
          return;
        }
        const q = { id: quizSnap.id, ...quizSnap.data() };
        if (q.ownerId !== user.uid) {
          setError("You do not have access to this quiz.");
          setLoading(false);
          return;
        }
        setQuiz(q);

        const aiSnap = await getDoc(doc(db, "aiInsights", quizId));
        if (aiSnap.exists()) setInsights(aiSnap.data());
      } catch (loadError) {
        setError(loadError.message || "Failed to load insights.");
      }
    }

    loadQuizAndCachedInsights();
  }, [quizId, user]);

  useEffect(() => {
    if (!quizId || !user) return undefined;
    const q = query(collection(db, "submissions"), where("quizId", "==", quizId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSubmissions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message || "Failed to load submissions.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [quizId, user]);

  const analyticsPayload = useMemo(() => {
    const questionAnalytics = (quiz?.questions || []).map((question, index) => {
      const answers = submissions.map((s) => s.answers?.[index]).filter(Boolean);
      const correct = answers.filter((a) => a.isCorrect).length;
      const optionCounts = question.options.map(
        (_, optionIndex) => answers.filter((a) => a.chosenIndex === optionIndex).length
      );
      return {
        questionLabel: `Q${index + 1}`,
        questionText: question.text,
        concept: question?.tags?.concept || "Uncategorized",
        correctRate: answers.length ? correct / answers.length : 0,
        avgConfidence: answers.length
          ? answers.reduce((acc, a) => acc + (a.confidence || 0), 0) / answers.length
          : 0,
        avgTime: answers.length
          ? answers.reduce((acc, a) => acc + (a.timeSpentSeconds || 0), 0) / answers.length
          : 0,
        optionCounts,
      };
    });

    const studentAnalytics = submissions.map((submission) => ({
      studentName: submission.studentName || "Unnamed",
      score: submission.score || 0,
      lowConfidenceCorrect: (submission.answers || []).filter(
        (a) => a.isCorrect && Number(a.confidence) <= 2
      ).length,
      highConfidenceWrong: (submission.answers || []).filter(
        (a) => !a.isCorrect && Number(a.confidence) >= 4
      ).length,
      fastWrong: (submission.answers || []).filter(
        (a) => !a.isCorrect && Number(a.timeSpentSeconds) < 3
      ).length,
    }));

    return {
      quizTitle: quiz?.title || "",
      teacherName: quiz?.teacherName || "",
      responseCount: submissions.length,
      questionAnalytics,
      studentAnalytics,
    };
  }, [quiz, submissions]);

  const signature = useMemo(() => {
    const latest = submissions.reduce(
      (max, s) => Math.max(max, s?.createdAt?.seconds || 0),
      0
    );
    return `${quiz?.updatedAt?.seconds || 0}-${submissions.length}-${latest}`;
  }, [quiz, submissions]);

  async function handleGenerateInsights() {
    if (!geminiApiKey) {
      toast.error("Missing GEMINI_API_KEY in env.");
      return;
    }
    if (!quiz) return;
    try {
      setGenerating(true);
      const result = await generateInsightsWithGemini({
        apiKey: geminiApiKey,
        quizTitle: quiz.title,
        teacherName: quiz.teacherName || user?.displayName || "Teacher",
        analyticsPayload,
      });

      const payload = {
        ownerId: quiz.ownerId,
        quizId,
        signature,
        generatedAt: serverTimestamp(),
        insights: result,
      };
      await setDoc(doc(db, "aiInsights", quizId), payload, { merge: true });
      await setDoc(
        doc(db, "studyGuides", quizId),
        {
          ownerId: quiz.ownerId,
          quizId,
          quizTitle: quiz.title,
          teacherName: quiz.teacherName || "",
          generatedAt: serverTimestamp(),
          studyGuide: result?.studyGuide || null,
        },
        { merge: true }
      );

      setInsights(payload);
      toast.success("AI insights generated and saved.");
    } catch (genError) {
      toast.error(genError.message || "Failed to generate insights.");
    } finally {
      setGenerating(false);
    }
  }

  if (!user) return <Navigate to="/signin" replace />;
  if (loading) return <div className="p-6 text-sm text-slate-700">Loading insights...</div>;
  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>;

  const studyGuideLink = `${window.location.origin}/studyguide/${quizId}`;
  const rendered = insights?.insights;

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">AI Insights</p>
              <h1 className="text-2xl font-bold text-slate-900">{quiz?.title}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/dashboard" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Back
              </Link>
              <button
                onClick={handleGenerateInsights}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                <FiRefreshCw />
                {generating ? "Generating..." : "Generate / Refresh"}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Cache Signature</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{insights?.signature || "Not generated"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Submissions Used</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{submissions.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">Study Guide</p>
            <div className="mt-2 flex gap-2">
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                onClick={() => navigator.clipboard.writeText(studyGuideLink)}
              >
                <FiShare2 /> Copy Link
              </button>
              <Link
                to={`/studyguide/${quizId}`}
                target="_blank"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-xs text-white"
              >
                <FiBookOpen /> Open
              </Link>
            </div>
          </div>
        </section>

        {!rendered ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">
              No AI insights yet. Click <span className="font-semibold">Generate / Refresh</span> to produce actionable class and student insights.
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FiZap /> Class Snapshot
              </p>
              <p className="mt-2 text-slate-800">{rendered?.classSummary?.headline}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Priority Concepts</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                    {(rendered?.classSummary?.priorityConcepts || []).map((item, idx) => (
                      <li key={`pc-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Reteach Now</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                    {(rendered?.classSummary?.reteachNow || []).map((item, idx) => (
                      <li key={`rt-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Student Action Plans</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(rendered?.studentActions || []).map((row, idx) => (
                  <div key={`sa-${idx}`} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-semibold text-slate-900">{row.studentName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.needsSupport ? "Needs support" : "On track"}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">{row.actionPlan}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Study Guide (Shareable)</p>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs"
                  onClick={() =>
                    downloadText(
                      `${(quiz?.title || "study-guide").replace(/\s+/g, "-").toLowerCase()}.txt`,
                      JSON.stringify(rendered?.studyGuide || {}, null, 2)
                    )
                  }
                >
                  Download
                </button>
              </div>
              <p className="mt-2 text-slate-800">{rendered?.studyGuide?.overview}</p>
              <div className="mt-3 space-y-3">
                {(rendered?.studyGuide?.sections || []).map((section, idx) => (
                  <div key={`sg-${idx}`} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-semibold text-slate-900">{section.topic}</p>
                    <p className="mt-1 text-sm text-slate-700">{section.whyItMatters}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}


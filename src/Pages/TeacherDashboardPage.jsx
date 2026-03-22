import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { FiBarChart2, FiCopy, FiEdit3, FiFileText, FiTrash2 } from "react-icons/fi";
import { signOutTeacher } from "../lib/auth";
import { db } from "../lib/firebase";

function timeAgo(ts) {
  if (!ts?.seconds) return null;
  const diff = Math.floor(Date.now() / 1000 - ts.seconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts.seconds * 1000).toLocaleDateString();
}

function scoreBg(p) { return p >= 70 ? "bg-emerald-500" : p >= 40 ? "bg-amber-400" : "bg-red-500"; }
function scoreText(p) { return p >= 70 ? "text-emerald-600" : p >= 40 ? "text-amber-600" : "text-red-600"; }

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}

export default function TeacherDashboardPage({ user }) {
  const [quizzes, setQuizzes] = useState([]);
  const [subStats, setSubStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "quizzes"), where("ownerId", "==", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      next.sort((a, b) => (b?.createdAt?.toMillis?.() || 0) - (a?.createdAt?.toMillis?.() || 0));
      setQuizzes(next);
      setLoading(false);
    }, (e) => { toast.error(e.message); setLoading(false); });
    return () => unsub();
  }, [user]);

  // Load all submissions for this teacher once
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "submissions"), where("ownerId", "==", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        const s = d.data();
        const qid = s.quizId;
        if (!qid) return;
        if (!map[qid]) map[qid] = { count: 0, totalScore: 0, totalQ: 0, lastAt: null };
        map[qid].count++;
        map[qid].totalScore += s.score || 0;
        map[qid].totalQ += 1; // submissions, not questions
        const ts = s.createdAt;
        if (!map[qid].lastAt || (ts?.seconds > map[qid].lastAt?.seconds)) map[qid].lastAt = ts;
      });
      setSubStats(map);
    });
    return () => unsub();
  }, [user]);

  if (!user) return <Navigate to="/signin" replace />;
  if (loading) return <LoadingSpinner />;

  async function handleDelete(quizId) {
    if (!window.confirm("Delete this quiz permanently?")) return;
    try { await deleteDoc(doc(db, "quizzes", quizId)); toast.success("Quiz deleted."); }
    catch (e) { toast.error(e.message || "Failed to delete."); }
  }

  async function copyLink(quiz) {
    const link = `${window.location.origin}/quiz/${quiz.id}`;
    try { await navigator.clipboard.writeText(link); toast.success("Link copied."); }
    catch { toast.error("Could not copy link."); }
  }

  // Aggregate totals
  const totalResponses = Object.values(subStats).reduce((a, s) => a + s.count, 0);
  const allAvgPcts = quizzes.map((q) => {
    const st = subStats[q.id];
    if (!st || !st.count || !q.questions?.length) return null;
    return (st.totalScore / st.count / q.questions.length) * 100;
  }).filter((v) => v !== null);
  const overallAvg = allAvgPcts.length ? allAvgPcts.reduce((a, b) => a + b, 0) / allAvgPcts.length : 0;

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">

        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">PulseCheck</h1>
            <p className="mt-0.5 text-sm text-gray-500">Welcome back, {user.displayName || user.email?.split("@")[0]}.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/builder" className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
              + New Quiz
            </Link>
            <button
              onClick={signOutTeacher}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Top stats */}
        {quizzes.length > 0 && (
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Quizzes", value: quizzes.length, sub: "created" },
              { label: "Total Responses", value: totalResponses, sub: "across all quizzes" },
              { label: "Overall Average", value: overallAvg > 0 ? `${Math.round(overallAvg)}%` : "—", sub: "class score" },
            ].map((s) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{s.label}</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900">{s.value}</p>
                <p className="mt-0.5 text-xs text-gray-400">{s.sub}</p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Quiz list */}
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">My Quizzes</h2>
          </div>

          {quizzes.length === 0 && (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">No quizzes yet.</p>
              <Link to="/builder" className="mt-4 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Create a Quiz
              </Link>
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {quizzes.map((quiz, i) => {
              const st = subStats[quiz.id] || { count: 0, totalScore: 0, lastAt: null };
              const avgPct = st.count && quiz.questions?.length
                ? Math.round((st.totalScore / st.count / quiz.questions.length) * 100)
                : null;

              return (
                <motion.div
                  key={quiz.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: i * 0.03 }}
                  className="px-6 py-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

                    {/* Quiz info */}
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {/* Score badge */}
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${avgPct !== null ? scoreBg(avgPct) : "bg-gray-100"}`}>
                        {avgPct !== null
                          ? <span className="text-xs font-bold">{avgPct}%</span>
                          : <FiFileText className="h-4 w-4 text-gray-400" />
                        }
                      </div>

                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{quiz.title}</p>

                        {/* Stats strip */}
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <FiFileText className="h-3 w-3" /> {quiz.questions?.length || 0} questions
                          </span>
                          {st.count > 0 ? (
                            <>
                              <span>·</span>
                              <span className="font-medium text-gray-600">{st.count} {st.count === 1 ? "response" : "responses"}</span>
                              {avgPct !== null && (
                                <>
                                  <span>·</span>
                                  <span className={`font-medium ${scoreText(avgPct)}`}>avg {avgPct}%</span>
                                </>
                              )}
                              {st.lastAt && (
                                <>
                                  <span>·</span>
                                  <span>{timeAgo(st.lastAt)}</span>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <span>·</span>
                              <span className="text-gray-300">no responses yet</span>
                            </>
                          )}
                        </div>

                        {/* Mini score bar */}
                        {avgPct !== null && (
                          <div className="mt-1.5 h-1.5 w-36 overflow-hidden rounded-full bg-gray-100">
                            <motion.div
                              className={`h-1.5 rounded-full ${scoreBg(avgPct)}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${avgPct}%` }}
                              transition={{ duration: 0.6, delay: i * 0.04 + 0.1, ease: "easeOut" }}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/builder/${quiz.id}`}
                        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <FiEdit3 /> Edit
                      </Link>
                      <Link
                        to={`/dashboard/quiz/${quiz.id}/responses`}
                        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <FiBarChart2 /> Responses {st.count > 0 && <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700">{st.count}</span>}
                      </Link>
                      <button
                        onClick={() => copyLink(quiz)}
                        className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        <FiCopy /> Copy Link
                      </button>
                      <button
                        onClick={() => handleDelete(quiz.id)}
                        className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

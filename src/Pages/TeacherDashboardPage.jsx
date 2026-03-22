import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { FiBarChart2, FiCopy, FiEdit3, FiFileText, FiTrash2, FiZap } from "react-icons/fi";
import { signOutTeacher } from "../lib/auth";
import { db } from "../lib/firebase";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return undefined;
    const q = query(collection(db, "quizzes"), where("ownerId", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        next.sort((a, b) => (b?.createdAt?.toMillis?.() || 0) - (a?.createdAt?.toMillis?.() || 0));
        setQuizzes(next);
        setLoading(false);
      },
      (err) => { setError(err.message || "Failed to load."); setLoading(false); }
    );
    return () => unsub();
  }, [user]);

  if (!user) return <Navigate to="/signin" replace />;
  if (loading) return <LoadingSpinner />;

  async function handleDelete(quizId) {
    if (!window.confirm("Delete this quiz permanently?")) return;
    try {
      await deleteDoc(doc(db, "quizzes", quizId));
      toast.success("Quiz deleted.");
    } catch (e) { toast.error(e.message || "Failed to delete."); }
  }

  async function copyLink(quiz) {
    const link = quiz.liveLink || `${window.location.origin}/quiz/${quiz.id}`;
    try { await navigator.clipboard.writeText(link); toast.success("Link copied."); }
    catch { toast.error("Could not copy link."); }
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">

        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">PulseCheck</h1>
            <p className="mt-0.5 text-sm text-gray-500">Manage your quizzes and review results.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-gray-400 sm:block">{user.displayName || user.email}</span>
            <Link to="/builder" className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
              New Quiz
            </Link>
            <button
              onClick={signOutTeacher}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">My Quizzes</h2>
          </div>

          {error && <p className="px-6 py-8 text-center text-sm text-red-600">{error}</p>}

          {!error && quizzes.length === 0 && (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">No quizzes yet.</p>
              <Link to="/builder" className="mt-4 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Create a Quiz
              </Link>
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {quizzes.map((quiz, i) => (
              <motion.div
                key={quiz.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: i * 0.04 }}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                {/* Quiz info */}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{quiz.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                    <FiFileText className="shrink-0" />
                    {quiz.questions?.length || 0} questions
                  </p>
                  <p className="mt-0.5 truncate text-xs text-gray-400">
                    {quiz.liveLink || `${window.location.origin}/quiz/${quiz.id}`}
                  </p>
                </div>

                {/* Action buttons — vertically centered via sm:items-center on parent */}
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
                    <FiBarChart2 /> Responses
                  </Link>
                  <Link
                    to={`/dashboard/quiz/${quiz.id}/insights`}
                    className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <FiZap /> AI Insights
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
                    <FiTrash2 /> Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import toast from "react-hot-toast";
import { FiBarChart2, FiCopy, FiEdit3, FiFileText, FiLogOut, FiPlusCircle, FiTrash2, FiZap } from "react-icons/fi";
import { signOutTeacher } from "../lib/auth";
import { db } from "../lib/firebase";

export default function TeacherDashboardPage({ user }) {
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return undefined;

    const q = query(collection(db, "quizzes"), where("ownerId", "==", user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        next.sort((a, b) => {
          const aTime = a?.createdAt?.toMillis?.() || 0;
          const bTime = b?.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
        setQuizzes(next);
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message || "Failed to load quizzes.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  if (!user) return <Navigate to="/signin" replace />;

  async function handleDeleteQuiz(quizId) {
    const confirmed = window.confirm("Delete this quiz permanently?");
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "quizzes", quizId));
      toast.success("Quiz deleted.");
    } catch (deleteError) {
      toast.error(deleteError.message || "Failed to delete quiz.");
    }
  }

  async function copyLiveLink(quiz) {
    const link = quiz.liveLink || `${window.location.origin}/quiz/${quiz.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Live link copied.");
    } catch {
      toast.error("Could not copy link.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between rounded-2xl bg-white p-5 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Quizzes</h1>
            <p className="text-sm text-slate-600">{user.displayName || user.email}</p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/builder"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
            >
              <FiPlusCircle />
              New Quiz
            </Link>
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              onClick={signOutTeacher}
            >
              <FiLogOut />
              Sign out
            </button>
          </div>
        </header>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          {loading && <p className="text-sm text-slate-600">Loading quizzes...</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!loading && !error && quizzes.length === 0 && (
            <p className="text-sm text-slate-600">No quizzes yet. Create your first quiz.</p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {quizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4"
              >
                <div>
                  <p className="text-lg font-semibold text-slate-900">{quiz.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Status: {quiz.status || "draft"} | Access code: {quiz.accessCode || "-"}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                    Live link: {quiz.liveLink || `${window.location.origin}/quiz/${quiz.id}`}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700">
                    <FiFileText />
                    {quiz.questions?.length || 0} questions
                  </span>
                  <Link
                    to={`/builder/${quiz.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                  >
                    <FiEdit3 />
                    Edit
                  </Link>
                  <Link
                    to={`/dashboard/quiz/${quiz.id}/responses`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                  >
                    <FiBarChart2 />
                    Responses
                  </Link>
                  <Link
                    to={`/dashboard/quiz/${quiz.id}/insights`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                  >
                    <FiZap />
                    AI Insights
                  </Link>
                  <button
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white"
                    onClick={() => copyLiveLink(quiz)}
                  >
                    <FiCopy />
                    Live Link
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-600"
                    onClick={() => handleDeleteQuiz(quiz.id)}
                  >
                    <FiTrash2 />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


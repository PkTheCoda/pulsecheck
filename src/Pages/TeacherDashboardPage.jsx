import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { signOutTeacher } from "../lib/auth";
import { db } from "../lib/firebase";

export default function TeacherDashboardPage({ user }) {
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return undefined;

    const q = query(
      collection(db, "quizzes"),
      where("ownerId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
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

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Quizzes</h1>
            <p className="text-sm text-slate-600">{user.displayName || user.email}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/builder" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
              New Quiz
            </Link>
            <button
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              onClick={signOutTeacher}
            >
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
          <div className="space-y-3">
            {quizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 p-4"
              >
                <div>
                  <p className="font-semibold text-slate-900">{quiz.title}</p>
                  <p className="text-xs text-slate-500">
                    Status: {quiz.status || "draft"} | Access code: {quiz.accessCode || "-"}
                  </p>
                </div>
                <span className="text-xs text-slate-500">{quiz.questions?.length || 0} questions</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


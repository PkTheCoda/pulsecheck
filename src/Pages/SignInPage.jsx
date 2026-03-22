import { useState } from "react";
import { Navigate } from "react-router-dom";
import { signInWithGoogle } from "../lib/auth";

export default function SignInPage({ user }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/builder" replace />;

  async function handleGoogleSignIn() {
    try {
      setLoading(true);
      setError("");
      await signInWithGoogle();
    } catch (e) {
      setError(e.message || "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6 font-sans">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Teacher Portal</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">PulseCheck</h1>
        <p className="mt-2 text-sm text-gray-600">
          Sign in to create and manage quizzes, view responses, and access AI insights.
        </p>
        <button
          className="mt-6 w-full rounded border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          {loading ? "Signing in..." : "Continue with Google"}
        </button>
        {error && (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        <p className="mt-6 text-center text-xs text-gray-400">
          For teachers only. Students use the quiz link shared by their teacher.
        </p>
      </div>
    </div>
  );
}

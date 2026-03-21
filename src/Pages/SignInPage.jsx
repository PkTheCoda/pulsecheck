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
    } catch (signInError) {
      setError(signInError.message || "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white">PulseCheck Teacher</h1>
        <p className="mt-2 text-sm text-slate-300">
          Sign in with Google to create and manage your quizzes.
        </p>
        <button
          className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-slate-900 transition hover:bg-slate-100 disabled:opacity-60"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          {loading ? "Signing in..." : "Continue with Google"}
        </button>
        {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
      </div>
    </div>
  );
}


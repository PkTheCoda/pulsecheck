import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { FiArrowRight, FiBarChart2, FiZap, FiUser } from "react-icons/fi";
import SiteHeader from "./SiteHeader";
import { usePageTitle } from "../hooks/usePageTitle";

const features = [
  {
    icon: FiBarChart2,
    title: "Score Analytics",
    desc: "Not just averages. Distribution charts, outlier alerts, time-per-question, and calibration scores in one view.",
  },
  {
    icon: FiZap,
    title: "AI Action Plans",
    desc: "Per-student plans that identify specific misconceptions and give you an exact opening line for each conversation.",
  },
  {
    icon: FiUser,
    title: "Class Pulse",
    desc: "One 0–100 readiness score that synthesizes accuracy, confidence calibration, and outliers. Updated instantly.",
  },
];

const mockBars = [
  { label: "Q1", pct: 91, color: "bg-emerald-500" },
  { label: "Q2", pct: 54, color: "bg-amber-400" },
  { label: "Q3", pct: 29, color: "bg-red-500" },
  { label: "Q4", pct: 83, color: "bg-emerald-500" },
  { label: "Q5", pct: 62, color: "bg-amber-400" },
];

export default function Hero({ user }) {
  usePageTitle(null);
  return (
    <div className="min-h-screen bg-white font-sans text-gray-900">

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <SiteHeader>
        {user ? (
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Dashboard <FiArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <>
            <Link to="/signin" className="text-sm text-gray-500 transition-colors hover:text-gray-900">
              Sign in
            </Link>
            <Link
              to="/signin"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Get started
            </Link>
          </>
        )}
      </SiteHeader>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 lg:pt-28 lg:pb-24">
        <div className="grid items-center gap-16 lg:grid-cols-2">

          {/* Left: text */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <p className="mb-4 inline-block rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">
              For K–12 educators
            </p>
            <h1 className="font-outfit text-4xl font-bold leading-[1.1] tracking-tight text-gray-900 sm:text-5xl lg:text-[3.25rem]">
              Your quiz results are trying to tell you something.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-gray-500">
              PulseCheck connects scores, confidence ratings, and timing to show you
              exactly where students are lost — and what to do about it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/signin"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700"
              >
                Build your first quiz <FiArrowRight />
              </Link>
              <Link
                to="/signin"
                className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
              >
                Already have an account →
              </Link>
            </div>
          </motion.div>

          {/* Right: mock dashboard */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
          >
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-200/80">
              {/* Card header */}
              <div className="border-b border-gray-100 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-gray-400">Cell Biology Quiz</p>
                    <p className="mt-0.5 text-sm font-semibold text-gray-900">24 responses</p>
                  </div>
                  <div className="flex gap-2">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-center">
                      <p className="text-base font-bold text-gray-900">78%</p>
                      <p className="text-xs text-gray-400">avg score</p>
                    </div>
                    {/* Class Pulse badge */}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center">
                      <p className="text-base font-bold text-amber-600">64</p>
                      <p className="text-xs text-amber-500">class pulse</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Accuracy bars */}
              <div className="px-5 py-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Question Accuracy</p>
                <div className="space-y-2.5">
                  {mockBars.map((bar, i) => (
                    <motion.div
                      key={bar.label}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.25 + i * 0.07 }}
                      className="flex items-center gap-3"
                    >
                      <span className="w-6 shrink-0 text-xs font-semibold text-gray-400">{bar.label}</span>
                      <div className="flex-1 overflow-hidden rounded-full bg-gray-100" style={{ height: 7 }}>
                        <motion.div
                          className={`rounded-full ${bar.color}`}
                          style={{ height: 7 }}
                          initial={{ width: 0 }}
                          animate={{ width: `${bar.pct}%` }}
                          transition={{ duration: 0.65, delay: 0.35 + i * 0.08, ease: "easeOut" }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-semibold text-gray-500">{bar.pct}%</span>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* AI insight strip */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="border-t border-gray-100 bg-blue-50 px-5 py-3"
              >
                <p className="text-xs text-gray-600">
                  <span className="font-semibold text-blue-700">AI:</span>{" "}
                  Q3 — 71% chose "mitochondria." They're confusing membrane structure with function.
                </p>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Social proof strip ───────────────────────────────────────────────── */}
      {/* <section className="border-y border-gray-100 bg-gray-50 px-6 py-5">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-2 text-sm text-gray-400">
          {["No setup required", "Real-time responses", "Per-student AI plans", "Free to start"].map((item) => (
            <span key={item} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-blue-400" />
              {item}
            </span>
          ))}
        </div>
      </section> */}

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      {/* <section className="bg-gray-50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 max-w-lg">
            <h2 className="font-outfit text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              From raw data to teaching moves.
            </h2>
            <p className="mt-3 text-gray-500">
              Built around the questions teachers actually ask after a quiz.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.07 }}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                  <f.icon className="h-4.5 w-4.5 text-blue-600" />
                </div>
                <h3 className="font-outfit font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section> */}

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="px-6 py-24 bg-gray-50">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-outfit text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Ready to see what your class actually knows?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-gray-500">
            Create a quiz in under two minutes. The analytics start the moment the first student submits.
          </p>
          <div className="mt-8">
            <Link
              to="/signin"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700"
            >
              Get started for free <FiArrowRight />
            </Link>
          </div>
          <p className="mt-4 text-xs text-gray-400">No credit card. No setup. Just a quiz.</p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-100">
              <FiBarChart2 className="h-3 w-3 text-blue-600" />
            </span>
            PulseCheck
          </div>
          <p className="text-xs text-gray-400">Powered by Gemini AI</p>
        </div>
      </footer>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

export default function StudyGuidePage() {
  const { quizId } = useParams();
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadGuide() {
      try {
        const snap = await getDoc(doc(db, "studyGuides", quizId));
        if (!snap.exists()) {
          setError("Study guide not found yet.");
          return;
        }
        setGuide(snap.data());
      } catch (loadError) {
        setError(loadError.message || "Failed to load study guide.");
      } finally {
        setLoading(false);
      }
    }
    loadGuide();
  }, [quizId]);

  if (loading) return <div className="p-6 text-sm text-slate-700">Loading study guide...</div>;
  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>;

  const sg = guide?.studyGuide;
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Study Guide</p>
          <h1 className="text-2xl font-bold text-slate-900">{guide?.quizTitle}</h1>
          <p className="mt-1 text-sm text-slate-600">From {guide?.teacherName || "your teacher"}</p>
        </header>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">{sg?.title || "Class Study Guide"}</h2>
          <p className="mt-2 text-slate-700">{sg?.overview}</p>
          <div className="mt-4 space-y-3">
            {(sg?.sections || []).map((section, idx) => (
              <div key={`section-${idx}`} className="rounded-xl border border-slate-200 p-3">
                <p className="font-semibold text-slate-900">{section.topic}</p>
                <p className="mt-1 text-sm text-slate-700">{section.whyItMatters}</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                  {(section.whatToReview || []).map((point, pIdx) => (
                    <li key={`review-${idx}-${pIdx}`}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


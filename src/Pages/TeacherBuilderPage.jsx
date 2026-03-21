import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { addDoc, arrayUnion, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { signOutTeacher } from "../lib/auth";
import { db, storage } from "../lib/firebase";
import { extractPdfText } from "../lib/pdf";
import { generateQuestionsWithGemini } from "../lib/gemini";

function makeAccessCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function normalizeQuestions(questions) {
  return questions.map((q, idx) => ({
    id: q.id || `q${idx + 1}`,
    text: q.text || "",
    options: Array.isArray(q.options) ? q.options.slice(0, 4) : ["", "", "", ""],
    correctAnswerIndex:
      typeof q.correctAnswerIndex === "number" ? q.correctAnswerIndex : 0,
    tags: {
      concept: q?.tags?.concept || "",
      subTopic: q?.tags?.subTopic || "",
      cognitiveLevel: q?.tags?.cognitiveLevel || "Recall",
      misconceptionKey: q?.tags?.misconceptionKey || "",
    },
    aiRationale: q.aiRationale || "",
  }));
}

export default function TeacherBuilderPage({ user }) {
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(30);
  const [questionCount, setQuestionCount] = useState(10);
  const geminiApiKey = import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";
  const [teacherNotes, setTeacherNotes] = useState("");
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceTextOverride, setSourceTextOverride] = useState("");
  const [questions, setQuestions] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  const canGenerate = useMemo(() => {
    return Boolean(title.trim() && geminiApiKey.trim() && (sourceFile || sourceTextOverride.trim()));
  }, [title, geminiApiKey, sourceFile, sourceTextOverride]);

  const canSave = useMemo(() => {
    return Boolean(user?.uid && title.trim() && questions.length > 0);
  }, [user, title, questions]);

  if (!user) return <Navigate to="/signin" replace />;

  async function getSourceText(file) {
    if (!file) return sourceTextOverride.trim();

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const text = await extractPdfText(file);
      if (text) return text;
    }

    const plainText = await file.text();
    return plainText.trim();
  }

  async function handleGenerate() {
    try {
      setIsGenerating(true);
      setStatus("Extracting source text...");
      const content = await getSourceText(sourceFile);
      if (!content) throw new Error("No source text found. Upload a readable file or paste text.");

      setStatus("Calling Gemini to generate questions...");
      const generated = await generateQuestionsWithGemini({
        apiKey: geminiApiKey.trim(),
        quizTitle: title.trim(),
        sourceText: content,
        questionCount: Number(questionCount) || 10,
      });

      setQuestions(normalizeQuestions(generated));
      setStatus(`Generated ${generated.length} questions. You can now save.`);
    } catch (error) {
      setStatus(error.message || "Failed to generate quiz.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveQuiz() {
    try {
      setIsSaving(true);
      setStatus("Saving quiz...");

      let sourceUrl = "";
      if (sourceFile) {
        const storageRef = ref(
          storage,
          `quiz-sources/${user.uid}/${Date.now()}-${sourceFile.name}`
        );
        await uploadBytes(storageRef, sourceFile);
        sourceUrl = await getDownloadURL(storageRef);
      }

      const accessCode = makeAccessCode();
      const docRef = await addDoc(collection(db, "quizzes"), {
        ownerId: user.uid,
        userId: user.uid,
        teacherId: user.uid,
        teacherName: user.displayName || user.email || "Teacher",
        title: title.trim(),
        accessCode,
        sourceUrl,
        questions,
        status: "draft",
        teacherNotes: teacherNotes.trim(),
        settings: {
          password: password.trim(),
          timer: Number(timerMinutes) || 30,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, "users", user.uid),
        {
          uid: user.uid,
          email: user.email || "",
          displayName: user.displayName || "",
          quizIds: arrayUnion(docRef.id),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      setStatus(`Saved draft quiz. quizId: ${docRef.id}, accessCode: ${accessCode}`);
    } catch (error) {
      setStatus(error.message || "Failed to save quiz.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateQuestionText(index, value) {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], text: value };
      return next;
    });
  }

  function updateOption(index, optionIndex, value) {
    setQuestions((prev) => {
      const next = [...prev];
      const options = [...next[index].options];
      options[optionIndex] = value;
      next[index] = { ...next[index], options };
      return next;
    });
  }

  function updateTag(index, key, value) {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], tags: { ...next[index].tags, [key]: value } };
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-3xl font-bold">Quiz Builder</h1>
            <p className="text-sm text-slate-600">
              Build fast checks from source files with AI, then save to your account.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
              My Quizzes
            </Link>
            <button
              onClick={signOutTeacher}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="grid gap-4 rounded-2xl bg-white p-4 shadow-sm md:grid-cols-2">
          <div className="rounded border bg-slate-50 p-2 text-sm text-slate-700">
            Signed in as: {user.displayName || user.email}
          </div>
          <input
            className="rounded border p-2"
            placeholder="Quiz title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="rounded border p-2"
            placeholder="Optional password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="rounded border p-2"
            type="number"
            min="1"
            placeholder="Timer (minutes)"
            value={timerMinutes}
            onChange={(e) => setTimerMinutes(e.target.value)}
          />
          <input
            className="rounded border p-2"
            type="number"
            min="1"
            max="30"
            placeholder="Question count"
            value={questionCount}
            onChange={(e) => setQuestionCount(e.target.value)}
          />
          <div className="rounded border bg-slate-50 p-2 text-sm text-slate-700">
            Gemini API key loaded from env: {geminiApiKey ? "yes" : "no"}
          </div>
          <div className="md:col-span-2">
            <input
              className="w-full rounded border p-2"
              type="file"
              accept=".pdf,.txt,.md,.csv"
              onChange={(e) => setSourceFile(e.target.files?.[0] || null)}
            />
          </div>
          <textarea
            className="min-h-36 rounded border p-2 md:col-span-2"
            placeholder="Optional: paste source text (used if no file or as fallback)"
            value={sourceTextOverride}
            onChange={(e) => setSourceTextOverride(e.target.value)}
          />
          <textarea
            className="min-h-24 rounded border p-2 md:col-span-2"
            placeholder="Optional teacher notes (shown in your dashboard/reporting later)"
            value={teacherNotes}
            onChange={(e) => setTeacherNotes(e.target.value)}
          />
          <div className="flex gap-2 md:col-span-2">
            <button
              className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:bg-slate-300"
              disabled={!canGenerate || isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? "Generating..." : "Generate Questions"}
            </button>
          </div>
          <p className="text-sm text-slate-700 md:col-span-2">{status}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Generated Questions ({questions.length})</h2>
          {questions.length === 0 && (
            <div className="rounded bg-white p-4 text-sm text-slate-600 shadow-sm">
              No questions yet.
            </div>
          )}
          {questions.map((q, idx) => (
            <div key={`${q.id}-${idx}`} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-600">Question {idx + 1}</p>
              <textarea
                className="min-h-20 w-full rounded border p-2"
                value={q.text}
                onChange={(e) => updateQuestionText(idx, e.target.value)}
              />
              <div className="grid gap-2 md:grid-cols-2">
                {q.options.map((option, optionIdx) => (
                  <input
                    key={`${q.id}-${optionIdx}`}
                    className="rounded border p-2"
                    value={option}
                    onChange={(e) => updateOption(idx, optionIdx, e.target.value)}
                    placeholder={`Option ${optionIdx + 1}`}
                  />
                ))}
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <select
                  className="rounded border p-2"
                  value={q.correctAnswerIndex}
                  onChange={(e) =>
                    setQuestions((prev) => {
                      const next = [...prev];
                      next[idx] = {
                        ...next[idx],
                        correctAnswerIndex: Number(e.target.value),
                      };
                      return next;
                    })
                  }
                >
                  <option value={0}>Correct: Option 1</option>
                  <option value={1}>Correct: Option 2</option>
                  <option value={2}>Correct: Option 3</option>
                  <option value={3}>Correct: Option 4</option>
                </select>
                <input
                  className="rounded border p-2"
                  value={q.tags.concept}
                  onChange={(e) => updateTag(idx, "concept", e.target.value)}
                  placeholder="Concept"
                />
                <input
                  className="rounded border p-2"
                  value={q.tags.subTopic}
                  onChange={(e) => updateTag(idx, "subTopic", e.target.value)}
                  placeholder="Sub-topic"
                />
                <select
                  className="rounded border p-2"
                  value={q.tags.cognitiveLevel}
                  onChange={(e) => updateTag(idx, "cognitiveLevel", e.target.value)}
                >
                  <option>Recall</option>
                  <option>Understanding</option>
                  <option>Application</option>
                </select>
              </div>
            </div>
          ))}
          {questions.length > 0 && (
            <div className="pt-2">
              <button
                className="rounded-lg bg-emerald-600 px-5 py-3 text-white disabled:bg-slate-300"
                disabled={!canSave || isSaving}
                onClick={handleSaveQuiz}
              >
                {isSaving ? "Saving..." : "Save Quiz Draft"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


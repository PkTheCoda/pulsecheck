import { useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
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

export default function TeacherBuilderPage() {
  const [teacherName, setTeacherName] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(30);
  const [questionCount, setQuestionCount] = useState(10);
  const geminiApiKey = import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";
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
    return Boolean(teacherName.trim() && title.trim() && questions.length > 0);
  }, [teacherName, title, questions]);

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
          `quiz-sources/${teacherName.trim()}/${Date.now()}-${sourceFile.name}`
        );
        await uploadBytes(storageRef, sourceFile);
        sourceUrl = await getDownloadURL(storageRef);
      }

      const accessCode = makeAccessCode();
      const docRef = await addDoc(collection(db, "quizzes"), {
        teacherId: teacherName.trim(),
        teacherName: teacherName.trim(),
        title: title.trim(),
        accessCode,
        sourceUrl,
        questions,
        status: "draft",
        settings: {
          password: password.trim(),
          timer: Number(timerMinutes) || 30,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setStatus(`Saved draft quiz. quizId: ${docRef.id}, accessCode: ${accessCode}`);
    } catch (error) {
      setStatus(error.message || "Failed to save quiz.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-3xl font-bold">PulseCheck - Teacher Quiz Builder (MVP)</h1>
        <p className="text-sm text-slate-600">
          Hackathon mode: upload a source, generate MCQs with Gemini, save straight to Firestore.
        </p>

        <section className="grid gap-4 rounded-lg bg-white p-4 shadow-sm md:grid-cols-2">
          <input
            className="rounded border p-2"
            placeholder="Teacher name"
            value={teacherName}
            onChange={(e) => setTeacherName(e.target.value)}
          />
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
          <div className="flex gap-2 md:col-span-2">
            <button
              className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-slate-300"
              disabled={!canGenerate || isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? "Generating..." : "Generate Questions"}
            </button>
            <button
              className="rounded bg-emerald-600 px-4 py-2 text-white disabled:bg-slate-300"
              disabled={!canSave || isSaving}
              onClick={handleSaveQuiz}
            >
              {isSaving ? "Saving..." : "Save Quiz Draft"}
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
            <div key={q.id} className="rounded-lg bg-white p-4 shadow-sm">
              <p className="font-semibold">{idx + 1}. {q.text}</p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {q.options.map((option, optionIdx) => (
                  <li key={`${q.id}-${optionIdx}`}>
                    {option} {q.correctAnswerIndex === optionIdx ? "(correct)" : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-600">
                Tags: {q.tags.concept} / {q.tags.subTopic} / {q.tags.cognitiveLevel}
              </p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}


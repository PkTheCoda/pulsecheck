import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { signOutTeacher } from "../lib/auth";
import { db } from "../lib/firebase";
import { extractPdfText } from "../lib/pdf";
import { generateQuestionsWithGemini } from "../lib/gemini";
import { useEffect } from "react";
import SiteHeader from "../Components/SiteHeader";
import { usePageTitle } from "../hooks/usePageTitle";

function makeAccessCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

const BUILTIN_TAG_KEYS = ["concept", "subTopic", "cognitiveLevel", "misconceptionKey"];

function normalizeQuestions(questions) {
  return questions.map((q, idx) => {
    const builtin = {
      concept: q?.tags?.concept || "",
      subTopic: q?.tags?.subTopic || "",
      cognitiveLevel: q?.tags?.cognitiveLevel || "Recall",
      misconceptionKey: q?.tags?.misconceptionKey || "",
    };
    const custom = { ...q?.tags };
    BUILTIN_TAG_KEYS.forEach((k) => delete custom[k]);
    return {
      id: q.id || `q${idx + 1}`,
      text: q.text || "",
      options: Array.isArray(q.options) ? q.options.slice(0, 4) : ["", "", "", ""],
      correctAnswerIndex:
        typeof q.correctAnswerIndex === "number" ? q.correctAnswerIndex : 0,
      tags: { ...builtin, ...custom },
      aiRationale: q.aiRationale || "",
    };
  });
}

function createEmptyQuestion() {
  return {
    id: `q${Date.now()}`,
    text: "",
    options: ["", "", "", ""],
    correctAnswerIndex: 0,
    tags: { concept: "", subTopic: "", cognitiveLevel: "Recall", misconceptionKey: "" },
    aiRationale: "",
  };
}

export default function TeacherBuilderPage({ user }) {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(quizId);
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(30);
  const [questionCount, setQuestionCount] = useState(10);
  const geminiApiKey = import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";
  const [teacherNotes, setTeacherNotes] = useState("");
  const [instructions, setInstructions] = useState("");
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceTextOverride, setSourceTextOverride] = useState("");
  const [questions, setQuestions] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const canGenerate = useMemo(() => {
    return Boolean(title.trim() && geminiApiKey.trim() && (sourceFile || sourceTextOverride.trim()));
  }, [title, geminiApiKey, sourceFile, sourceTextOverride]);

  const canSave = useMemo(() => {
    if (!user?.uid || !title.trim() || questions.length === 0) return false;
    return questions.every(
      (q) =>
        (q.text || "").trim() &&
        (q.options || []).every((o) => (o || "").trim())
    );
  }, [user, title, questions]);

  if (!user) return <Navigate to="/signin" replace />;

  useEffect(() => {
    async function loadQuiz() {
      if (!user || !quizId) return;
      try {
        setIsLoadingQuiz(true);
        const quizRef = doc(db, "quizzes", quizId);
        const snap = await getDoc(quizRef);

        if (!snap.exists()) {
          toast.error("Quiz not found.");
          return;
        }

        const quiz = snap.data();
        if (quiz.ownerId !== user.uid) {
          toast.error("You do not have access to this quiz.");
          return;
        }

        setTitle(quiz.title || "");
        setPassword(quiz?.settings?.password || "");
        setTimerMinutes(quiz?.settings?.timer || 30);
        const qs = normalizeQuestions(quiz.questions || []);
        setQuestions(qs);
        if (qs.length > 0) setHasGenerated(true);
        setTeacherNotes(quiz.teacherNotes || "");
        setInstructions(quiz.instructions || "");
        setStatus(`Editing quiz: ${snap.id}`);
      } catch (error) {
        toast.error(error.message || "Failed to load quiz.");
      } finally {
        setIsLoadingQuiz(false);
      }
    }

    loadQuiz();
  }, [quizId, user]);

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
      setHasGenerated(true);
      setActiveTab("questions");
      setStatus(`Generated ${generated.length} questions. You can now save.`);
      toast.success(`Generated ${generated.length} questions`);
    } catch (error) {
      setStatus(error.message || "Failed to generate quiz.");
      toast.error(error.message || "Failed to generate quiz.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveQuiz() {
    try {
      setIsSaving(true);
      setStatus("Saving quiz...");

      const basePayload = {
        ownerId: user.uid,
        userId: user.uid,
        teacherId: user.uid,
        teacherName: user.displayName || user.email || "Teacher",
        title: title.trim(),
        questions,
        status: "draft",
        teacherNotes: teacherNotes.trim(),
        instructions: instructions.trim(),
        settings: {
          password: password.trim(),
          timer: Number(timerMinutes) || 30,
        },
        updatedAt: serverTimestamp(),
      };

      if (quizId) {
        await updateDoc(doc(db, "quizzes", quizId), basePayload);
        const liveLink = `${window.location.origin}/quiz/${quizId}`;
        await updateDoc(doc(db, "quizzes", quizId), { liveLink });
        toast.success("Quiz updated.");
        navigate("/dashboard");
      } else {
        const accessCode = makeAccessCode();
        const docRef = await addDoc(collection(db, "quizzes"), {
          ...basePayload,
          accessCode,
          createdAt: serverTimestamp(),
        });

        const liveLink = `${window.location.origin}/quiz/${docRef.id}`;
        await updateDoc(doc(db, "quizzes", docRef.id), { liveLink });

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
        toast.success("Quiz saved.");
        navigate("/dashboard");
      }
    } catch (error) {
      setStatus(error.message || "Failed to save quiz.");
      toast.error(error.message || "Failed to save quiz.");
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

  function removeTag(index, key) {
    setQuestions((prev) => {
      const next = [...prev];
      const tags = { ...next[index].tags };
      delete tags[key];
      next[index] = { ...next[index], tags };
      return next;
    });
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, createEmptyQuestion()]);
  }

  function deleteQuestion(index) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  const [activeTab, setActiveTab] = useState("details");
  const [addTagModal, setAddTagModal] = useState(null); // { questionIndex }
  const [newTagKey, setNewTagKey] = useState("");

  function openAddTagModal(questionIndex) {
    setAddTagModal({ questionIndex });
    setNewTagKey("");
  }

  function closeAddTagModal() {
    setAddTagModal(null);
    setNewTagKey("");
  }

  function submitAddTag() {
    if (!addTagModal || !newTagKey.trim()) return;
    const key = newTagKey.trim().replace(/\s+/g, "_").toLowerCase();
    if (BUILTIN_TAG_KEYS.includes(key)) return;
    const q = questions[addTagModal.questionIndex];
    if (q?.tags && key in q.tags) return;
    updateTag(addTagModal.questionIndex, key, "");
    closeAddTagModal();
  }

  const inputBase =
    "w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  const labelBase = "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600";

  usePageTitle(isEditing ? (title || "Edit Quiz") : "New Quiz");

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <SiteHeader>
  
        <Link
          to="/dashboard"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          My Quizzes
        </Link>
        <button
          onClick={signOutTeacher}
          className="rounded border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          Sign out
        </button>
      </SiteHeader>

      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Sticky Tabs */}
        <div className="sticky top-[53px] z-10 -mx-6 bg-gray-100 px-6 pb-2 pt-3">
          <div className="mb-3">
            <h1 className="text-lg font-semibold text-gray-900">
              {isEditing ? `Edit: ${title || "Quiz"}` : "New Quiz"}
            </h1>
            <p className="text-xs text-gray-500">
              {isEditing ? "Update the live version anytime." : "Build questions manually or generate them from source material."}
            </p>
          </div>

          {/* Tabs + Save */}
          <div className="flex items-end justify-between border-b border-gray-200 bg-gray-100">
            <nav className="-mb-px flex gap-6">
              <button
                onClick={() => setActiveTab("details")}
                className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === "details"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setActiveTab("questions")}
                className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === "questions"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                Questions {questions.length > 0 && `(${questions.length})`}
              </button>
            </nav>
            <button
              className="-mb-px mb-2 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
              disabled={!canSave || isSaving}
              onClick={handleSaveQuiz}
            >
              {isSaving ? "Saving..." : isEditing ? "Update Quiz Draft" : "Save Quiz Draft"}
            </button>
          </div>
        </div>

        {/* Details Tab */}
        {activeTab === "details" && (
          <div className="space-y-6">
            {/* Title */}
            <div>
              <label className={labelBase}>Title</label>
              <input
                type="text"
                className={inputBase}
                placeholder="e.g. History Overview"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Quiz Instructions */}
            <div>
              <label className={labelBase}>Quiz Instructions</label>
              <textarea
                className={`${inputBase} min-h-[120px] resize-y`}
                placeholder="Instructions shown to students on the welcome page..."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                {instructions.split(/\s+/).filter(Boolean).length} words
              </p>
            </div>

            {/* Quiz Settings */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-700">
                Quiz Settings
              </h3>
              <div className="space-y-4">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <label className={labelBase}>Quiz Type</label>
                    <select
                      className={inputBase}
                      value="graded"
                      readOnly
                    >
                      <option value="graded">Graded Quiz</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelBase}>Time Limit (minutes)</label>
                    <input
                      type="number"
                      min="1"
                      className={inputBase}
                      value={timerMinutes}
                      onChange={(e) => setTimerMinutes(e.target.value)}
                    />
                  </div>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-4">
                  <label className={labelBase}>Require access code</label>
                  <input
                    type="text"
                    className={`${inputBase} max-w-xs`}
                    placeholder="Leave blank for no password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Source Content */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-700">
                Source Content
              </h3>
              <div className="space-y-4">
                <div>
                  <label className={labelBase}>Upload file (PDF, TXT, MD, CSV)</label>
                  <input
                    type="file"
                    accept=".pdf,.txt,.md,.csv"
                    className={`${inputBase} cursor-pointer file:mr-4 file:rounded file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700`}
                    onChange={(e) => setSourceFile(e.target.files?.[0] || null)}
                  />
                  {sourceFile && (
                    <p className="mt-1 text-xs text-gray-600">{sourceFile.name}</p>
                  )}
                </div>
                <div>
                  <label className={labelBase}>Or paste source text</label>
                  <textarea
                    className={`${inputBase} min-h-[140px] resize-y`}
                    placeholder="Paste content from your materials (used if no file or as fallback)"
                    value={sourceTextOverride}
                    onChange={(e) => setSourceTextOverride(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* AI Generation */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-700">
                AI Generation
              </h3>
              <div className="space-y-4">
                <div className="max-w-[200px]">
                  <label className={labelBase}>Question count</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    className={inputBase}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
                    disabled={!canGenerate || isGenerating || hasGenerated}
                    onClick={handleGenerate}
                  >
                    {isGenerating ? "Generating..." : hasGenerated ? "Already generated" : "Generate Questions"}
                  </button>
                </div>
                {status && (
                  <p className="text-xs text-gray-600">{isLoadingQuiz ? "Loading quiz..." : status}</p>
                )}
              </div>
            </div>

            {/* Teacher Notes */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-700">
                Teacher Notes
              </h3>
              <textarea
                className={`${inputBase} min-h-[80px] resize-y`}
                placeholder="Private notes for your dashboard and reporting (not shown to students)"
                value={teacherNotes}
                onChange={(e) => setTeacherNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Questions Tab */}
        {activeTab === "questions" && (
          <div className="space-y-6">
            {questions.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
                <p className="text-sm font-medium text-gray-700">No questions yet</p>
                <p className="mt-1 text-xs text-gray-400">Add questions manually, or generate them from source material in the Details tab.</p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={addQuestion}
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    + Add Question Manually
                  </button>
                  <button
                    onClick={() => setActiveTab("details")}
                    className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Generate with AI →
                  </button>
                </div>
              </div>
            ) : (
              <>
                {questions.map((q, idx) => {
                  const customTagEntries = Object.entries(q.tags || {}).filter(
                    ([k]) => !BUILTIN_TAG_KEYS.includes(k)
                  );
                  return (
                  <div
                    key={`${q.id}-${idx}`}
                    className="rounded-lg border border-gray-200 bg-white p-6"
                  >
                    <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
                      <span className="text-sm font-semibold text-gray-700">
                        Question {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteQuestion(idx)}
                        className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Delete question"
                        title="Delete question"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    <textarea
                      className={`${inputBase} mb-4 min-h-[72px]`}
                      value={q.text}
                      onChange={(e) => updateQuestionText(idx, e.target.value)}
                      placeholder="Question text"
                    />
                    <div className="mb-4 space-y-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Answer choices (click circle for correct)</p>
                      {q.options.map((option, optionIdx) => (
                        <div
                          key={`${q.id}-${optionIdx}`}
                          className="flex items-center gap-3"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setQuestions((prev) => {
                                const next = [...prev];
                                next[idx] = {
                                  ...next[idx],
                                  correctAnswerIndex: optionIdx,
                                };
                                return next;
                              })
                            }
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-gray-400 transition-colors hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            aria-label={`Mark option ${String.fromCharCode(65 + optionIdx)} as correct`}
                          >
                            {q.correctAnswerIndex === optionIdx && (
                              <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                            )}
                          </button>
                          <input
                            className={`${inputBase} flex-1`}
                            value={option}
                            onChange={(e) => updateOption(idx, optionIdx, e.target.value)}
                            placeholder={`Option ${String.fromCharCode(65 + optionIdx)}`}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-3 border-t border-gray-100 pt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Tags</p>
                      <div className="flex flex-wrap gap-3">
                        <input
                          className={`${inputBase} max-w-[180px]`}
                          value={q.tags.concept || ""}
                          onChange={(e) => updateTag(idx, "concept", e.target.value)}
                          placeholder="Concept"
                        />
                        <input
                          className={`${inputBase} max-w-[180px]`}
                          value={q.tags.subTopic || ""}
                          onChange={(e) => updateTag(idx, "subTopic", e.target.value)}
                          placeholder="Sub-topic"
                        />
                        <select
                          className={`${inputBase} max-w-[140px]`}
                          value={q.tags.cognitiveLevel || "Recall"}
                          onChange={(e) => updateTag(idx, "cognitiveLevel", e.target.value)}
                        >
                          <option>Recall</option>
                          <option>Understanding</option>
                          <option>Application</option>
                        </select>
                        {customTagEntries.map(([k]) => (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                          >
                            {k}
                            <button
                              type="button"
                              onClick={() => removeTag(idx, k)}
                              className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                              aria-label={`Remove tag ${k}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => openAddTagModal(idx)}
                          className="rounded border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:border-gray-400 hover:bg-gray-50"
                        >
                          + Add tag
                        </button>
                      </div>
                    </div>
                  </div>
                );})}
                <div className="flex justify-center border-t border-gray-200 pt-8">
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="rounded border border-dashed border-gray-300 bg-white px-6 py-4 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50"
                  >
                    + Add Question
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Add Tag Modal */}
        {addTagModal !== null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={closeAddTagModal}
          >
            <div
              className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-700">
                Add Custom Tag
              </h3>
              <div>
                <label className={labelBase}>Tag name</label>
                <input
                  type="text"
                  className={inputBase}
                  placeholder="e.g. chapter, unit"
                  value={newTagKey}
                  onChange={(e) => setNewTagKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitAddTag()}
                />
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeAddTagModal}
                  className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitAddTag}
                  disabled={!newTagKey.trim()}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
                >
                  Add Tag
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


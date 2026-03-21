# Teacher Quiz Platform - Detailed Technical Specification (Teacher-Side MVP)

## 1) Product Vision and Positioning

Build the educational equivalent of "when2meet" for formative assessment:
- Teachers create and deploy a quiz in minutes.
- Quiz generation is AI-assisted from classroom material (PDF/slides/text).
- Teachers get immediate, live insights (not just scores), especially misconception patterns.

### Core Differentiator
- **Speed over perfection**: this is optimized for quick checks/homework, not high-stakes exams.
- **No student sign-in required** (teacher-side MVP still plans data model with anonymous student responses).
- **Actionable teacher guidance**: AI tells teachers what to say/do next, not only charts.

---

## 2) Scope Definition

## In Scope (Teacher-Side MVP)
- Teacher creates quiz (title, subject, optional password, due window).
- Teacher uploads source content (PDF/slides/text).
- AI generates multiple-choice questions.
- Teacher edits questions and metadata tags, then publishes.
- System issues public quiz link and quiz code.
- Teacher dashboard:
  - Live submissions list.
  - Question-level performance heatmap.
  - Tag-level analytics.
  - AI-generated "5-minute fix" coaching script.
  - Exportable report (PDF).

## Explicitly Out of Scope (for now)
- Student portal UX details and student auth flows.
- Advanced proctoring or anti-cheat.
- Gradebook sync integrations (Google Classroom, Canvas, etc.).
- Subjective/free-response questions.

---

## 3) User Roles (Current Phase)

- **Teacher** (primary actor): creates, edits, publishes, monitors, exports.
- **Admin/Developer** (internal role): observes logs, manages model/version config.

Note: Student participation is represented in backend contracts but full student-side product design is deferred.

---

## 4) Teacher Experience (End-to-End Flow)

1. Teacher clicks **Create Quiz**.
2. Inputs quiz basics:
   - Quiz title
   - Subject/class label
   - Optional password lock
   - Optional availability window
3. Uploads source material:
   - PDF / slide deck / pasted text
4. AI generation pipeline runs:
   - Extract content -> semantic chunks -> LO/tag mapping -> question generation -> distractor engineering
5. Teacher reviews draft:
   - Edit question wording
   - Edit choices/correct answer
   - Edit tags (concept, Bloom level, difficulty, misconception labels)
6. Teacher publishes quiz:
   - Receives shareable public link + short quiz code
7. During live response window, teacher dashboard updates in real time:
   - Submission feed
   - Heatmap by question
   - Tag mastery and misconception spikes
8. Teacher clicks **Generate Insights**:
   - 5-minute fix script
   - Grouping recommendations
   - Follow-up refresher quiz suggestions (teacher-side action only)
9. Teacher exports report PDF.

---

## 5) Functional Requirements (Teacher-Side)

## 5.1 Quiz Authoring
- Create/edit/delete draft quiz.
- Question type: multiple-choice only.
- 4 answer choices default (configurable to 3-5 later).
- Correct answer required before publish.
- Manual reorder of questions.
- Version history snapshot on publish.

## 5.2 AI Quiz Generation
- Accept input artifacts (PDF/slides/text).
- Generate 5/10/15/20-question sets.
- Every question must include tags:
  - `conceptTag`
  - `difficulty` (1-5)
  - `bloomLevel` (Recall/Understanding/Application)
  - `misconceptionMap` for distractors

## 5.3 Publishing and Access Control
- Publish creates immutable `publishedVersion`.
- Public quiz URL and short code generated.
- Optional quiz password gate.
- Allow unpublish/close submissions from teacher dashboard.

## 5.4 Live Monitoring + Analytics
- Real-time question accuracy.
- Real-time distractor distribution.
- Tag-level mastery map.
- Time-per-question distributions (based on response telemetry).

## 5.5 AI Insights for Teacher
- Auto-generated:
  - "What students likely misunderstood"
  - "What to reteach now"
  - "Fast intervention script"
- Recommendations must reference observed metrics/tags.

## 5.6 Reporting
- One-click PDF export including:
  - Quiz metadata
  - Question analytics
  - Tag analytics
  - AI insight summary

---

## 6) Non-Functional Requirements

- **Speed targets**:
  - Create quiz draft < 10 seconds
  - AI generate 10 questions from <=30 pages in < 60-90 seconds
  - Real-time dashboard update latency < 2 seconds
- **Reliability**:
  - Idempotent generation jobs
  - Publish operation must be atomic
- **Scalability**:
  - Handle multiple classes/quizzes running simultaneously
- **Security**:
  - Password lock support for public quiz access
  - Strict teacher data ownership rules
- **Cost control**:
  - Token and model-use metering
  - Caching extracted text/chunks for regeneration

---

## 7) Firebase-First System Architecture

## 7.1 Recommended Firebase Services
- **Firebase Authentication**
  - Teacher auth via Google/email link.
  - Anonymous/public access only for quiz-taking endpoints.
- **Cloud Firestore**
  - Primary data store for quizzes, questions, submissions, analytics, insight artifacts.
- **Cloud Storage**
  - Raw uploaded files (PDF/slides), parsed text artifacts, generated report files.
- **Cloud Functions (2nd gen)**
  - Orchestrate AI pipeline, tagging, analytics aggregation, reporting jobs.
- **Cloud Tasks / Pub/Sub**
  - Queue and decouple long-running AI generation + report generation.
- **Firebase Hosting**
  - Serve web app.
- **Firebase App Check**
  - Protect callable/http functions from abuse.
- **Cloud Logging + Monitoring**
  - Job observability, model failures, latency alerts.

## 7.2 High-Level Architecture Diagram (Logical)

1. React frontend -> Firebase Auth for teacher session.
2. Frontend uploads source file -> Cloud Storage.
3. Frontend creates generation job doc in Firestore.
4. Cloud Function trigger processes job:
   - Parse -> chunk -> generate tags/questions -> store draft.
5. Teacher edits draft in Firestore-backed UI.
6. Publish Cloud Function snapshots quiz version and creates public access metadata.
7. Submission events stream into Firestore.
8. Aggregation Functions maintain analytics docs.
9. Insights Function builds teacher scripts and recommendations.
10. Report Function creates PDF in Storage, URL returned to teacher.

---

## 8) Firestore Data Model (Teacher-Focused)

Use teacher-first partitioning for security and query efficiency.

## 8.1 Collections Overview

- `teachers/{teacherId}`
- `teachers/{teacherId}/quizzes/{quizId}`
- `teachers/{teacherId}/quizzes/{quizId}/versions/{versionId}`
- `teachers/{teacherId}/quizzes/{quizId}/generationJobs/{jobId}`
- `teachers/{teacherId}/quizzes/{quizId}/insights/{insightId}`
- `publicQuizzes/{publicQuizId}` (minimal metadata for public access routing)
- `quizSubmissions/{publicQuizId}/attempts/{attemptId}` (student-side data stored for analytics)
- `analytics/{publicQuizId}` (aggregated counters/materialized views)

## 8.2 Document Shapes (Suggested)

### `teachers/{teacherId}`
```json
{
  "displayName": "Jane Doe",
  "email": "jane@school.edu",
  "createdAt": "timestamp",
  "planTier": "free"
}
```

### `teachers/{teacherId}/quizzes/{quizId}`
```json
{
  "title": "Cell Biology Quick Check",
  "subject": "Biology",
  "status": "draft|published|closed",
  "passwordEnabled": true,
  "passwordHash": "argon2-hash",
  "currentVersionId": "v3",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "publishedAt": "timestamp|null",
  "settings": {
    "questionCount": 10,
    "shuffleQuestions": false,
    "shuffleOptions": true,
    "timeLimitSec": null
  }
}
```

### `teachers/{teacherId}/quizzes/{quizId}/versions/{versionId}`
```json
{
  "versionNumber": 3,
  "sourceArtifacts": [
    {
      "storagePath": "uploads/teacherId/quizId/chapter3.pdf",
      "mimeType": "application/pdf",
      "pageCount": 24
    }
  ],
  "questions": [
    {
      "questionId": "q1",
      "prompt": "Which organelle ...",
      "options": [
        {"id": "A", "text": "Rough ER"},
        {"id": "B", "text": "Smooth ER"},
        {"id": "C", "text": "Golgi apparatus"},
        {"id": "D", "text": "Lysosome"}
      ],
      "correctOptionId": "A",
      "tags": {
        "conceptTag": "Cell Organelle Function",
        "difficulty": 3,
        "bloomLevel": "Application",
        "topicHierarchy": ["Biology", "Cell Biology", "Endomembrane System"]
      },
      "misconceptionMap": {
        "B": "Confuses smooth ER with rough ER ribosome role",
        "C": "Thinks packaging = synthesis site",
        "D": "Mixes digestion with transport"
      }
    }
  ],
  "createdBy": "teacherId",
  "createdAt": "timestamp"
}
```

### `teachers/{teacherId}/quizzes/{quizId}/generationJobs/{jobId}`
```json
{
  "status": "queued|processing|completed|failed",
  "input": {
    "artifactPaths": ["uploads/.../chapter3.pdf"],
    "questionCount": 10
  },
  "pipeline": {
    "extractStatus": "done",
    "chunkStatus": "done",
    "tagStatus": "done",
    "questionGenStatus": "done",
    "distractorStatus": "done"
  },
  "error": null,
  "startedAt": "timestamp",
  "completedAt": "timestamp"
}
```

### `analytics/{publicQuizId}`
```json
{
  "submissionCount": 28,
  "questionStats": {
    "q1": {
      "correctRate": 0.43,
      "optionDistribution": {"A": 12, "B": 14, "C": 1, "D": 1},
      "medianTimeSec": 21
    }
  },
  "tagStats": {
    "Application": {"attempts": 84, "correctRate": 0.38},
    "Cell Organelle Function": {"attempts": 56, "correctRate": 0.41}
  },
  "updatedAt": "timestamp"
}
```

---

## 9) Backend Services and Function Contracts

## 9.1 Cloud Functions (Suggested Set)

- `createQuizDraft` (callable)
  - Creates initial draft quiz record.
- `startGenerationJob` (callable/http)
  - Validates upload refs, enqueues generation task.
- `processGenerationJob` (task-triggered)
  - Runs AI pipeline stages and writes generated draft version.
- `publishQuiz` (callable)
  - Creates immutable published version, public link metadata.
- `closeQuiz` (callable)
  - Stops new submissions.
- `recomputeAnalytics` (event/task)
  - Rebuilds aggregates from submissions (fallback/backfill).
- `generateTeacherInsights` (callable/task)
  - Produces narrative insights + "5-minute fix."
- `exportReportPdf` (callable/task)
  - Generates and stores PDF report.

## 9.2 Idempotency + Failure Strategy

- Every job has deterministic `jobId`.
- Stage-level status fields prevent duplicate work.
- On failure, write structured `errorCode`, `errorMessage`, `retryCount`.
- Dead-letter queue for repeated failures.

---

## 10) AI Generation Pipeline (Implementation Blueprint)

## Stage A: Ingestion and Extraction
- Parse PDF/slides into structured text + layout metadata.
- Normalize headers/bullets/tables where possible.
- Store extraction artifact in Storage and pointer in Firestore.

## Stage B: Semantic Chunking
- Chunk by concept boundaries, not page boundaries.
- Include:
  - `chunkId`
  - `sourceSpan`
  - `estimatedComplexity`
  - `primaryConcept`

## Stage C: Learning Objective + Tag Mapping
- For each chunk, produce:
  - Topic hierarchy (`Subject > Topic > Subtopic`)
  - Bloom level target
  - Difficulty estimate (1-5)

## Stage D: Question Generation
- Produce MCQs tied to chunk + LO.
- Enforce formatting constraints:
  - Single unambiguous correct answer
  - Similar option lengths
  - No giveaway grammar cues

## Stage E: Distractor Engineering
- Generate distractors as plausible misconceptions.
- Each wrong option must include misconception label (for analytics interpretation).

## Stage F: Validation and Ranking
- Rule-based and LLM-as-judge checks:
  - Answerability from source
  - Non-duplication
  - Clarity/readability
- Keep best N questions by quality score.

---

## 11) Analytics Engine (Teacher View)

## 11.1 Real-Time Metrics
- Submission velocity (responses/minute).
- Per-question:
  - Correct rate
  - Option distribution
  - Median response time
- Per-tag:
  - Accuracy by concept
  - Accuracy by Bloom level
  - Difficulty-adjusted performance

## 11.2 Insight Logic
- **Pattern detector examples**
  - High wrong concentration on one distractor -> misconception spike.
  - Low speed + low accuracy on same tag -> conceptual struggle.
  - High speed + correct + low confidence (future extension) -> uncertain mastery.
- **Output artifacts**
  - 5-minute reteach script
  - Grouping recommendations
  - Refresher quiz blueprint

---

## 12) Security Model (Firebase)

## 12.1 Authentication
- Teacher must be authenticated for all authoring/analytics actions.
- Public endpoints for quiz attempts remain separate and minimal.

## 12.2 Firestore Security Rules (Principles)
- Teachers can read/write only their own namespace:
  - `/teachers/{teacherId}/...` only if `request.auth.uid == teacherId`.
- Public quiz metadata restricted to safe fields only.
- Never expose raw password hashes to clients.

## 12.3 Password Locking
- Store only hashed password (Argon2/bcrypt in function).
- Verify in backend function, then issue short-lived access token/custom claim for attempt session.

## 12.4 Abuse Protection
- App Check on callable/http functions.
- Rate-limit generation and insight endpoints per teacher.
- File upload constraints: MIME/type/size limits.

---

## 13) API Surface (Teacher-Side)

Recommended callable endpoints (via Firebase Functions):
- `createQuizDraft(payload)`
- `uploadSourceComplete(payload)` (after Storage upload)
- `startGenerationJob(payload)`
- `regenerateQuestion(payload)`
- `publishQuiz(payload)`
- `closeQuiz(payload)`
- `generateTeacherInsights(payload)`
- `exportReportPdf(payload)`

All responses should include:
- `requestId`
- `status`
- `data`
- `error` (structured)

---

## 14) Frontend Structure (Teacher-Focused)

Suggested route map:
- `/teacher/dashboard`
- `/teacher/quiz/new`
- `/teacher/quiz/:quizId/edit`
- `/teacher/quiz/:quizId/publish`
- `/teacher/quiz/:quizId/live`
- `/teacher/quiz/:quizId/report`

Suggested component groups:
- Quiz Builder
- Source Upload + Generation Status
- Question Editor + Tag Editor
- Live Analytics Board
- Insight Panel ("5-minute fix")
- Export/Share Panel

State/data strategy:
- Firestore listeners for real-time docs (quiz, analytics, submissions summary).
- Callable functions for mutations/heavy jobs.

---

## 15) Performance and Cost Strategy

- Cache extraction/chunk artifacts per uploaded file hash.
- Use smaller model for draft generation, larger model only for insight summarization where needed.
- Batch analytics updates (every few seconds) to avoid write amplification.
- Use materialized analytics docs for fast dashboard reads.

---

## 16) Observability and Quality Controls

- Log each pipeline stage with `quizId`, `jobId`, model name, token usage, latency.
- Dashboard alerts:
  - Generation failure rate
  - P95 generation latency
  - Function error spikes
- Human-in-the-loop safety:
  - Teacher always reviews before publish.
  - Flag low-confidence generated questions.

---

## 17) MVP Build Plan (Teacher Side First)

## Phase 1 - Core Authoring + Publish
- Teacher auth
- Quiz CRUD
- Manual question editing
- Publish + share link + password lock

## Phase 2 - AI Generation Pipeline
- Upload artifacts
- Generation jobs and progress tracking
- Draft question/tag generation

## Phase 3 - Live Dashboard + Basic Analytics
- Real-time submissions feed
- Question/tag analytics cards

## Phase 4 - AI Insights + PDF Export
- 5-minute fix script generation
- Grouping recommendations
- PDF report output

---

## 18) Future Enhancement Backlog (Post-MVP)

- Confidence rating per answer (`Sure/Unsure`) and confidence-accuracy matrix.
- One-click targeted refresher quiz generation from weakest tags.
- LMS exports/integrations.
- Historical teacher/class trend dashboard.

---

## 19) Suggested Repo Folder Structure (Implementation)

```text
src/
  app/
  features/
    teacher-auth/
    quiz-builder/
    ai-generation/
    live-analytics/
    teacher-insights/
    report-export/
  services/
    firebase/
    api/
functions/
  src/
    quiz/
    generation/
    analytics/
    insights/
    reporting/
firestore.rules
firestore.indexes.json
storage.rules
docs/
  teacher-side-platform-spec.md
```

---

## 20) Decision Checklist Before Coding

- Confirm teacher auth method (Google vs email link).
- Confirm max upload size + supported slide formats.
- Confirm model provider(s) and fallback strategy.
- Confirm if generated questions can cite source snippet in UI.
- Confirm report branding requirements.

---

## 21) Final Recommendation

Start with a thin but reliable teacher loop:
1) create draft,
2) generate/edit questions,
3) publish/share,
4) watch live analytics,
5) get instant reteach script.

If this loop is fast and trustworthy, student-side and deeper analytics can scale naturally on top of the same Firebase architecture.


const GEMINI_MODEL = "gemini-2.5-flash";

function extractJson(text) {
  const clean = text.trim();
  if (clean.startsWith("```")) {
    const noFence = clean.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(noFence);
  }
  return JSON.parse(clean);
}

export async function generateQuestionsWithGemini({ apiKey, quizTitle, sourceText, questionCount }) {
  const prompt = `
You are generating a teacher multiple-choice quiz. Return ONLY valid JSON.

Output format:
{
  "questions": [
    {
      "id": "q1",
      "text": "question text",
      "options": ["A", "B", "C", "D"],
      "correctAnswerIndex": 0,
      "tags": { "concept": "string", "subTopic": "string", "cognitiveLevel": "Recall|Understanding|Application", "misconceptionKey": "string" },
      "aiRationale": "short explanation"
    }
  ]
}

Rules: ${questionCount} questions, 4 options each, one correct answer, plausible distractors, classroom-friendly.

Quiz title: ${quizTitle}
Source:
${sourceText.slice(0, 18000)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: "application/json" } }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`);
  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
  if (!text) throw new Error("Gemini returned empty response.");
  const parsed = extractJson(text);
  if (!Array.isArray(parsed?.questions)) throw new Error("Unexpected Gemini format.");
  return parsed.questions;
}

export async function generateInsightsWithGemini({ apiKey, quizTitle, teacherName, analyticsPayload }) {
  const prompt = `
You are a concise education analytics assistant. Return ONLY valid JSON. Keep every text field to 1 sentence unless noted.

Schema:
{
  "classSummary": {
    "headline": "one sentence — class performance pattern",
    "priorityConcepts": ["up to 3 concept names"],
    "reteachNow": ["up to 3 specific items to reteach"],
    "readinessVerdict": "one sentence — ready to advance or not"
  },
  "studentActions": [
    {
      "studentName": "exact name from data",
      "needsSupport": boolean,
      "riskLevel": "high|medium|low",
      "focusAreas": ["up to 2"],
      "actionPlan": "2 sentences max",
      "misconceptionProfile": ["up to 2 specific misconceptions from their wrong answers"],
      "strengthAreas": ["up to 2"],
      "conversationStarter": "exact opening sentence for teacher to say to this student",
      "readyToMoveOn": boolean,
      "priorityQuestions": ["Q1"]
    }
  ],
  "questionInsights": [
    {
      "questionLabel": "Q1",
      "issue": "one sentence",
      "teacherMove": "one sentence",
      "topMisconception": "one sentence — what wrong-answer students were thinking",
      "distractorAnalysis": "one sentence — why the wrong option is tempting"
    }
  ],
  "studyGuide": {
    "title": "string",
    "overview": "2 sentences max",
    "sections": [
      { "topic": "string", "whyItMatters": "one sentence", "practiceTips": ["up to 3 short tips"] }
    ]
  }
}

Include ALL students. Max 3 studyGuide sections. Be specific and data-driven — reference actual wrong answers.

Teacher: ${teacherName}
Quiz: ${quizTitle}
Data:
${JSON.stringify(analyticsPayload).slice(0, 14000)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }),
  });
  if (!res.ok) throw new Error(`Gemini insight error: ${await res.text()}`);
  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
  if (!text) throw new Error("Gemini returned empty insights.");
  return extractJson(text);
}

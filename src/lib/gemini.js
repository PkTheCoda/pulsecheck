const GEMINI_MODEL = "gemini-2.5-flash";

function extractJson(text) {
  const clean = text.trim();
  if (clean.startsWith("```")) {
    const noFence = clean.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(noFence);
  }
  return JSON.parse(clean);
}

export async function generateQuestionsWithGemini({
  apiKey,
  quizTitle,
  sourceText,
  questionCount,
}) {
  const prompt = `
You are generating a teacher homework check multiple-choice quiz.
Return ONLY valid JSON (no markdown, no explanation).

Output format:
{
  "questions": [
    {
      "id": "q1",
      "text": "question text",
      "options": ["A", "B", "C", "D"],
      "correctAnswerIndex": 0,
      "tags": {
        "concept": "string",
        "subTopic": "string",
        "cognitiveLevel": "Recall|Understanding|Application",
        "misconceptionKey": "string"
      },
      "aiRationale": "short explanation"
    }
  ]
}

Rules:
- Generate exactly ${questionCount} questions.
- Multiple choice only, exactly 4 options each.
- One clearly correct answer.
- Use plausible distractors.
- Keep wording classroom-friendly.

Quiz title: ${quizTitle}
Source content:
${sourceText.slice(0, 18000)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini request failed: ${err}`);
  }

  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts?.[0]?.text ||
    payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const parsed = extractJson(text);
  if (!Array.isArray(parsed?.questions)) {
    throw new Error("Gemini response was not in expected questions format.");
  }

  return parsed.questions;
}

export async function generateInsightsWithGemini({
  apiKey,
  quizTitle,
  teacherName,
  analyticsPayload,
}) {
  const prompt = `
You are an education analytics assistant. Return ONLY valid JSON.

Task:
- Analyze quiz performance data and provide actionable teacher insights.
- Include both class-level and student-level recommendations.
- Create a short, practical study guide teachers can share with students.

Output schema:
{
  "classSummary": {
    "headline": "string",
    "priorityConcepts": ["string"],
    "reteachNow": ["string"]
  },
  "classSentiment": {
    "label": "Well-Calibrated|Overconfident|Underconfident|Struggling",
    "headline": "one sentence describing the class mood and engagement patterns",
    "recommendation": "one specific, actionable thing the teacher should do next based on sentiment"
  },
  "studentActions": [
    {
      "studentName": "string",
      "needsSupport": true,
      "riskLevel": "high|medium|low",
      "focusAreas": ["string"],
      "actionPlan": "string"
    }
  ],
  "questionInsights": [
    {
      "questionLabel": "Q1",
      "issue": "string",
      "teacherMove": "string"
    }
  ],
  "studyGuide": {
    "title": "string",
    "overview": "string",
    "sections": [
      {
        "topic": "string",
        "whyItMatters": "string",
        "whatToReview": ["string"],
        "practiceTips": ["string"]
      }
    ],
    "quickQuiz": [
      {
        "prompt": "string",
        "answerHint": "string"
      }
    ]
  }
}

Keep the output concise, specific, and classroom-practical.

Teacher: ${teacherName}
Quiz: ${quizTitle}
Analytics payload:
${JSON.stringify(analyticsPayload).slice(0, 18000)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini insight request failed: ${err}`);
  }

  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts?.[0]?.text ||
    payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");

  if (!text) throw new Error("Gemini returned empty insights response.");
  return extractJson(text);
}

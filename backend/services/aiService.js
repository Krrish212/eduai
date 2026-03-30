/**
 * AI SERVICE
 * Wraps the Anthropic SDK for all EduAI AI features:
 *   1. Misconception detection from submission error patterns
 *   2. Adaptive question generation
 *   3. Mini-lesson / explanation generation
 *   4. Practice set generation
 */

const Anthropic = require('@anthropic-ai/sdk');
const { AIQueueItem, Student } = require('../models');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-20250514';

// ─── HELPER: call Claude and get JSON back ────────────────────────────────────
async function callClaude(systemPrompt, userPrompt, maxTokens = 1000) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');

  // Strip markdown fences if present
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { raw };
  }

  return {
    data: parsed,
    promptTokens:  msg.usage?.input_tokens  || 0,
    outputTokens:  msg.usage?.output_tokens || 0,
  };
}

// ─── 1. MISCONCEPTION DETECTION ──────────────────────────────────────────────
/**
 * Analyse a student's recent wrong answers and classify misconceptions.
 * Called after each batch of submissions or on-demand.
 */
async function detectMisconceptions(studentId, recentWrongAnswers) {
  if (!recentWrongAnswers.length) return [];

  const system = `You are an expert mathematics education analyst specialising in misconception detection.
Analyse student wrong answers and classify each into one of four error types:
- procedural: incorrect algorithm steps or order of operations
- conceptual: fundamental misunderstanding of the mathematical principle
- notation: symbol confusion or misreading of the problem
- transfer: inability to apply a known concept in an unfamiliar context

Return ONLY valid JSON — no explanation, no markdown fences.`;

  const user = `Student wrong answers (topic → their response):
${recentWrongAnswers.map(a => `Topic: ${a.topic}\nQuestion: ${a.questionText}\nStudent answer: ${a.response}\nCorrect: ${a.correctAnswer}`).join('\n---\n')}

Return a JSON array of detected misconceptions:
[
  {
    "topic": "string",
    "errorType": "procedural|conceptual|notation|transfer",
    "label": "short human-readable label (e.g. Sine ratio inversion)",
    "errorPattern": "machine key (e.g. sine_ratio_inversion)",
    "severity": "low|medium|high",
    "explanation": "one sentence explaining the error",
    "confidence": 0-100
  }
]`;

  const { data, promptTokens, outputTokens } = await callClaude(system, user, 800);
  const misconceptions = Array.isArray(data) ? data : [];

  // Persist to student record (merge with existing, avoid duplicates)
  if (misconceptions.length) {
    const student = await Student.findById(studentId);
    for (const m of misconceptions) {
      const existing = student.misconceptions.find(
        x => x.errorPattern === m.errorPattern && !x.resolved
      );
      if (existing) {
        existing.frequency += 1;
      } else {
        student.misconceptions.push({
          topic:      m.topic,
          errorType:  m.errorType,
          label:      m.label,
          severity:   m.severity,
          detectedAt: new Date(),
        });
      }
    }
    await student.save();
  }

  return misconceptions;
}

// ─── 2. ADAPTIVE QUESTION GENERATION ─────────────────────────────────────────
async function generateQuestion({ topic, difficulty, misconceptionLabel, studentName, curriculumRef }) {
  const system = `You are an expert mathematics question writer for UK secondary education (KS4/GCSE).
Generate questions that are:
- Precisely targeted at a specific misconception when provided
- Appropriately scaffolded for the difficulty band
- Accompanied by realistic distractors that reflect common errors
- Always solvable and unambiguous

Difficulty bands: remedial (foundation), easy (lower), medium (core GCSE), hard (higher), extension (beyond GCSE)

Return ONLY valid JSON — no explanation, no markdown.`;

  const user = `Generate one mathematics question for the following context:
Topic: ${topic}
Difficulty: ${difficulty}
Student: ${studentName || 'a Year 11 student'}
${misconceptionLabel ? `Target misconception: ${misconceptionLabel}` : ''}
${curriculumRef ? `Curriculum reference: ${curriculumRef}` : ''}

Return JSON:
{
  "questionText": "full question text",
  "correctAnswer": "full worked answer with method shown",
  "distractors": ["wrong answer 1 with error label", "wrong answer 2 with error label"],
  "hints": ["hint 1 (gentle)", "hint 2 (more specific)", "hint 3 (near-complete)"],
  "explanation": "explanation of why the correct method works",
  "aiReasoning": "why this question targets the specified gap",
  "confidence": 0-100,
  "riskIndicator": "low|medium|high"
}`;

  const { data, promptTokens, outputTokens } = await callClaude(system, user, 900);

  return {
    content: {
      questionText:  data.questionText,
      correctAnswer: data.correctAnswer,
      distractors:   data.distractors || [],
      explanation:   data.explanation,
      hints:         data.hints || [],
    },
    aiReasoning:   data.aiReasoning,
    aiConfidence:  data.confidence || 75,
    riskIndicator: data.riskIndicator || 'low',
    promptTokens,
    outputTokens,
  };
}

// ─── 3. MINI-LESSON GENERATION ────────────────────────────────────────────────
async function generateMiniLesson({ topic, misconceptionLabel, errorType, targetStudents }) {
  const system = `You are an expert mathematics teacher creating concise remediation micro-lessons for UK KS4 students.
Lessons must be:
- Brief (3–5 minutes to read)
- Structured: concept → diagram description → worked example → self-check
- Written for the student directly (second person)
- Targeted precisely at the identified misconception

Return ONLY valid JSON.`;

  const user = `Create a micro-lesson for:
Topic: ${topic}
Misconception: ${misconceptionLabel}
Error type: ${errorType}
Target: ${targetStudents} student(s)

Return JSON:
{
  "lessonTitle": "string",
  "lessonBody": "full lesson text in markdown (use ## for sections, **bold** for key terms)",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "checkYourselfQuestions": [
    { "question": "...", "answer": "..." }
  ],
  "aiReasoning": "why this lesson design addresses the misconception",
  "confidence": 0-100
}`;

  const { data, promptTokens, outputTokens } = await callClaude(system, user, 1200);

  return {
    content: {
      questionText: data.lessonTitle,
      lessonBody:   data.lessonBody,
      hints:        data.keyPoints || [],
      explanation:  (data.checkYourselfQuestions || []).map(q => `${q.question} → ${q.answer}`).join('\n'),
    },
    aiReasoning:   data.aiReasoning,
    aiConfidence:  data.confidence || 80,
    riskIndicator: 'low',
    promptTokens,
    outputTokens,
  };
}

// ─── 4. CREATE AI QUEUE ITEM ──────────────────────────────────────────────────
/**
 * High-level function: generate content AND save to AIQueueItem in one step.
 * This is what routes call.
 */
async function createQueueItem({ type, courseId, studentId, studentIds, studentName, topic, difficulty, misconceptionLabel, errorType, curriculumRef }) {
  let generated;

  if (type === 'question') {
    generated = await generateQuestion({ topic, difficulty, misconceptionLabel, studentName, curriculumRef });
  } else if (type === 'mini_lesson') {
    generated = await generateMiniLesson({ topic, misconceptionLabel, errorType, targetStudents: studentIds?.length || 1 });
  } else {
    throw new Error(`Unknown AI item type: ${type}`);
  }

  const item = await AIQueueItem.create({
    course:        courseId,
    targetStudent: studentId || null,
    targetGroup:   studentIds || [],
    type,
    topic,
    difficulty:    difficulty || 'medium',
    content:       generated.content,
    aiReasoning:   generated.aiReasoning,
    aiConfidence:  generated.aiConfidence,
    riskIndicator: generated.riskIndicator,
    modelUsed:     MODEL,
    promptTokens:  generated.promptTokens,
    outputTokens:  generated.outputTokens,
    status:        'pending',
  });

  return item;
}

// ─── 5. STUDENT CHAT ASSISTANT ────────────────────────────────────────────────
async function studentChatResponse({ studentName, topic, question, conversationHistory, masteryLevel }) {
  const system = `You are EduAI, a friendly and encouraging mathematics tutor for UK secondary school students (Year 11).
Your role:
- Guide students to answers through questions and hints — never just give the answer
- Use simple, clear language appropriate for 15–16 year olds
- Reference the specific topic the student is working on
- Be encouraging but academically rigorous
- If the student seems stuck, escalate the hint level gradually
- Keep responses concise (2–4 sentences unless a worked example is needed)
The student's current mastery level in ${topic}: ${masteryLevel || 'unknown'}/100`;

  const messages = [
    ...(conversationHistory || []),
    { role: 'user', content: question }
  ];

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system,
    messages,
  });

  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

module.exports = {
  detectMisconceptions,
  generateQuestion,
  generateMiniLesson,
  createQueueItem,
  studentChatResponse,
};

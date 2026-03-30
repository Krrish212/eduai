const mongoose = require('mongoose');
const { Schema } = mongoose;

// ─── COURSE ──────────────────────────────────────────────────────────────────
const CourseSchema = new Schema({
  name:       { type: String, required: true },          // "Year 11 Mathematics"
  code:       { type: String, required: true, unique: true }, // "Y11-MATHS"
  subject:    { type: String, default: 'Mathematics' },
  yearGroup:  { type: String, default: 'Year 11' },
  term:       { type: String, default: 'Term 2' },
  week:       { type: Number, default: 1 },
  topics:     [{ name: String, week: Number, curriculumRef: String }],
  createdAt:  { type: Date, default: Date.now }
});

// ─── STUDENT ──────────────────────────────────────────────────────────────────
const StudentSchema = new Schema({
  name:      { type: String, required: true },
  initials:  { type: String, required: true },
  email:     { type: String },
  courses:   [{ type: Schema.Types.ObjectId, ref: 'Course' }],

  // Per-topic mastery map  { "Algebra": 0.81, "Trigonometry": 0.48 }
  topicMastery: { type: Map, of: Number, default: {} },

  // Rolling KPI values (recomputed by cron/on-demand)
  kpi: {
    successProbability: { type: Number, default: 0.5 },  // 0–1
    engagementScore:    { type: Number, default: 50 },   // 0–100
    consistencyScore:   { type: Number, default: 0.5 },  // 0–1
    improvementRate:    { type: Number, default: 0 },    // % per week
    riskLevel:          { type: String, enum: ['low','medium','high'], default: 'low' },
    riskScore:          { type: Number, default: 0 },    // 0–100
    riskFlags:          [String],
  },

  // Detected misconceptions  [{ topic, type, label, detectedAt }]
  misconceptions: [{
    topic:       String,
    errorType:   { type: String, enum: ['procedural','conceptual','notation','transfer'] },
    label:       String,
    frequency:   { type: Number, default: 1 },
    severity:    { type: String, enum: ['low','medium','high'] },
    detectedAt:  { type: Date, default: Date.now },
    resolved:    { type: Boolean, default: false }
  }],

  createdAt: { type: Date, default: Date.now }
});

// ─── SUBMISSION ───────────────────────────────────────────────────────────────
// One record per student per question attempt
const SubmissionSchema = new Schema({
  student:      { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  course:       { type: Schema.Types.ObjectId, ref: 'Course',  required: true },
  topic:        { type: String, required: true },
  questionText: { type: String },
  questionId:   { type: String },               // stable ID for deduplication
  response:     { type: String },               // student's answer
  isCorrect:    { type: Boolean, required: true },
  score:        { type: Number, min: 0, max: 100 },
  timeSpentSec: { type: Number, default: 0 },   // seconds on this question
  hintsUsed:    { type: Number, default: 0 },
  attemptNumber:{ type: Number, default: 1 },
  submittedAt:  { type: Date, default: Date.now },
  // AI-flagged error pattern
  errorPattern: { type: String },              // e.g. "sine_ratio_inversion"
  errorVector:  [Number],                      // embedding for clustering (optional)
});
SubmissionSchema.index({ student: 1, topic: 1, submittedAt: -1 });
SubmissionSchema.index({ course: 1, submittedAt: -1 });

// ─── KPI SNAPSHOT ─────────────────────────────────────────────────────────────
// Historical record written by the KPI cron job each day
const KPISnapshotSchema = new Schema({
  course:          { type: Schema.Types.ObjectId, ref: 'Course' },
  snapshotDate:    { type: Date, default: Date.now },
  classAvgScore:   Number,
  atRiskCount:     Number,
  avgTopicMastery: Number,
  avgEngagement:   Number,
  pendingQueue:    Number,
  topicBreakdown:  { type: Map, of: Number },  // { Algebra: 0.81, ... }
  submissionHealth:{ onTime: Number, late: Number, missing: Number }
});
KPISnapshotSchema.index({ course: 1, snapshotDate: -1 });

// ─── AI QUEUE ITEM ────────────────────────────────────────────────────────────
const AIQueueItemSchema = new Schema({
  course:       { type: Schema.Types.ObjectId, ref: 'Course' },
  targetStudent:{ type: Schema.Types.ObjectId, ref: 'Student' }, // null = whole class
  targetGroup:  [{ type: Schema.Types.ObjectId, ref: 'Student' }],
  type:         { type: String, enum: ['question','mini_lesson','practice_set','reference_card'], required: true },
  topic:        { type: String, required: true },
  difficulty:   { type: String, enum: ['remedial','easy','medium','hard','extension'], default: 'medium' },

  // AI-generated content
  content: {
    questionText:  String,
    correctAnswer: String,
    distractors:   [String],
    explanation:   String,
    lessonBody:    String,    // for mini_lesson type
    hints:         [String],
  },

  // AI reasoning metadata
  aiReasoning:    { type: String },
  aiConfidence:   { type: Number, min: 0, max: 100 },
  riskIndicator:  { type: String, enum: ['low','medium','high'], default: 'low' },
  modelUsed:      { type: String, default: 'claude-sonnet-4-20250514' },
  promptTokens:   Number,
  outputTokens:   Number,

  // Review state
  status:         { type: String, enum: ['pending','approved','edited_approved','rejected'], default: 'pending' },
  teacherEdits:   { type: String },   // teacher's modifications before approval
  reviewedAt:     { type: Date },

  // Delivery
  deliveredAt:    { type: Date },
  lmsAssignmentId:{ type: String },

  createdAt:      { type: Date, default: Date.now }
});
AIQueueItemSchema.index({ status: 1, createdAt: -1 });

// ─── INTERVENTION ─────────────────────────────────────────────────────────────
const InterventionSchema = new Schema({
  student:       { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  course:        { type: Schema.Types.ObjectId, ref: 'Course' },
  riskSnapshot:  { riskScore: Number, riskFlags: [String] },
  recommendation:{ type: String },
  aiQueueItem:   { type: Schema.Types.ObjectId, ref: 'AIQueueItem' },
  status:        { type: String, enum: ['open','in_progress','delivered','resolved','no_change'], default: 'open' },
  outcome: {
    scoreChange:      Number,   // pp change 4 weeks after
    engagementChange: Number,
    resolved:         Boolean,
    measuredAt:       Date,
  },
  createdAt: { type: Date, default: Date.now }
});

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  Course:       mongoose.model('Course',       CourseSchema),
  Student:      mongoose.model('Student',      StudentSchema),
  Submission:   mongoose.model('Submission',   SubmissionSchema),
  KPISnapshot:  mongoose.model('KPISnapshot',  KPISnapshotSchema),
  AIQueueItem:  mongoose.model('AIQueueItem',  AIQueueItemSchema),
  Intervention: mongoose.model('Intervention', InterventionSchema),
};

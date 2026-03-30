/**
 * KPI ENGINE
 * Computes all student and class-level KPIs from raw submission data.
 * Called by the cron job, by API routes on-demand, and after each submission.
 *
 * Outputs written back to Student.kpi and Student.topicMastery in MongoDB.
 */

const { Student, Submission, KPISnapshot } = require('../models');

// ─── CONSTANTS (override via .env) ───────────────────────────────────────────
const RISK_HIGH     = Number(process.env.RISK_SCORE_HIGH)       || 75;
const RISK_MEDIUM   = Number(process.env.RISK_SCORE_MEDIUM)     || 55;
const ENG_THRESHOLD = Number(process.env.ENGAGEMENT_THRESHOLD)  || 65;
const MASTERY_LOW   = Number(process.env.MASTERY_LOW_THRESHOLD) || 50;
const LAMBDA        = 0.85;   // recency decay for mastery
const ALPHA         = 0.4;    // EWM smoothing for score velocity
const HINT_OVERUSE  = 0.6;    // hint ratio above which flag is raised

// ─── TOPIC MASTERY ────────────────────────────────────────────────────────────
/**
 * Exponentially weighted rolling accuracy per topic.
 * Most-recent attempts count most (weight = λ^i).
 * Returns map: { "Algebra": 0.81, "Trigonometry": 0.48 }
 */
async function computeTopicMastery(studentId) {
  const subs = await Submission.find({ student: studentId })
    .sort({ submittedAt: -1 })
    .limit(200)
    .lean();

  const byTopic = {};
  for (const s of subs) {
    if (!byTopic[s.topic]) byTopic[s.topic] = [];
    byTopic[s.topic].push(s.isCorrect ? 1 : 0);
  }

  const mastery = {};
  for (const [topic, results] of Object.entries(byTopic)) {
    let weightedSum = 0, weightTotal = 0;
    results.forEach((r, i) => {
      const w = Math.pow(LAMBDA, i);
      weightedSum += r * w;
      weightTotal += w;
    });
    mastery[topic] = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) / 100 : 0;
  }
  return mastery;
}

// ─── ENGAGEMENT SCORE ─────────────────────────────────────────────────────────
/**
 * Composite score 0–100 from four signals:
 *   sessionFrequency (30%) + timeOnTask (30%) + hintUsageRate inverted (20%) + submissionLatency (20%)
 */
async function computeEngagement(studentId, courseId) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000); // last 7 days
  const subs = await Submission.find({
    student: studentId,
    course: courseId,
    submittedAt: { $gte: cutoff }
  }).lean();

  if (!subs.length) return 30; // no activity = low

  // Session frequency: how many days in last 7 had activity
  const activeDays = new Set(subs.map(s => s.submittedAt.toDateString())).size;
  const freqScore = Math.min(100, (activeDays / 7) * 100);

  // Time on task: avg seconds per submission vs expected 120s
  const avgTime = subs.reduce((a, s) => a + (s.timeSpentSec || 0), 0) / subs.length;
  const timeScore = Math.min(100, (avgTime / 120) * 100);

  // Hint usage: inverted (lower hint rate = higher score)
  const totalHints = subs.reduce((a, s) => a + (s.hintsUsed || 0), 0);
  const hintRate = totalHints / subs.length;
  const hintScore = Math.max(0, 100 - (hintRate / HINT_OVERUSE) * 100);

  // Submission rate proxy: attempted / expected (rough: 3/day expected)
  const expectedSubs = 7 * 3;
  const submissionScore = Math.min(100, (subs.length / expectedSubs) * 100);

  const engagement = Math.round(
    freqScore * 0.30 +
    timeScore  * 0.30 +
    hintScore  * 0.20 +
    submissionScore * 0.20
  );

  return Math.min(100, Math.max(0, engagement));
}

// ─── CONSISTENCY SCORE ────────────────────────────────────────────────────────
/**
 * 1 − (σ / μ) of the last 5 session scores, clamped to [0, 1].
 * Higher = more stable performance.
 */
async function computeConsistency(studentId) {
  const recent = await Submission.find({ student: studentId })
    .sort({ submittedAt: -1 })
    .limit(20)
    .lean();

  if (recent.length < 3) return 0.5;

  // Group into sessions of ~5 questions, take avg score per session
  const sessions = [];
  for (let i = 0; i < recent.length; i += 5) {
    const chunk = recent.slice(i, i + 5);
    const avg = chunk.reduce((a, s) => a + (s.score || (s.isCorrect ? 100 : 0)), 0) / chunk.length;
    sessions.push(avg);
  }

  if (sessions.length < 2) return 0.5;
  const mean = sessions.reduce((a, b) => a + b, 0) / sessions.length;
  const variance = sessions.reduce((a, s) => a + Math.pow(s - mean, 2), 0) / sessions.length;
  const sd = Math.sqrt(variance);
  const cv = mean > 0 ? sd / mean : 1;
  return Math.round(Math.max(0, Math.min(1, 1 - cv)) * 100) / 100;
}

// ─── IMPROVEMENT RATE ─────────────────────────────────────────────────────────
/**
 * Exponentially weighted moving average of weekly score delta.
 * Returns percentage-points change per week.
 */
async function computeImprovementRate(studentId) {
  const subs = await Submission.find({ student: studentId })
    .sort({ submittedAt: -1 })
    .limit(100)
    .lean();

  if (subs.length < 5) return 0;

  // Split into 2-week windows
  const now = Date.now();
  const week1 = subs.filter(s => now - s.submittedAt < 7 * 864e5);
  const week2 = subs.filter(s => {
    const age = now - s.submittedAt;
    return age >= 7 * 864e5 && age < 14 * 864e5;
  });

  if (!week1.length || !week2.length) return 0;

  const avg = arr => arr.reduce((a, s) => a + (s.score || (s.isCorrect ? 100 : 0)), 0) / arr.length;
  const delta = avg(week1) - avg(week2);
  return Math.round(delta * 10) / 10;
}

// ─── SUCCESS PROBABILITY ──────────────────────────────────────────────────────
/**
 * Logistic-style score combining:
 *   gradePercentile × consistency × submissionRate × improvementFactor
 * Returns 0–1.
 */
async function computeSuccessProbability(studentId, courseId) {
  const allSubs = await Submission.find({ student: studentId, course: courseId }).lean();
  if (!allSubs.length) return 0.5;

  const correctRate = allSubs.filter(s => s.isCorrect).length / allSubs.length;
  const consistency = await computeConsistency(studentId);
  const improvement = await computeImprovementRate(studentId);
  const improveFactor = Math.min(1.2, 1 + improvement / 100);

  // Submission rate: submitted vs expected over course lifetime
  const submissionRate = Math.min(1, allSubs.length / 50);

  const raw = correctRate * 0.45 +
              consistency * 0.25 +
              submissionRate * 0.20 +
              Math.max(0, Math.min(1, improveFactor - 1)) * 0.10;

  return Math.round(raw * 100) / 100;
}

// ─── RISK SCORE & FLAGS ───────────────────────────────────────────────────────
/**
 * Composite risk score 0–100 from multiple signals.
 * Also returns an array of plain-English flag strings.
 */
async function computeRisk(studentId, courseId) {
  const flags = [];
  let score = 0;

  const subs = await Submission.find({ student: studentId, course: courseId })
    .sort({ submittedAt: -1 })
    .limit(50)
    .lean();

  // Score drop signal
  const recent5  = subs.slice(0, 5);
  const previous5 = subs.slice(5, 10);
  if (recent5.length && previous5.length) {
    const avg = arr => arr.reduce((a, s) => a + (s.score || (s.isCorrect ? 100 : 0)), 0) / arr.length;
    const drop = avg(previous5) - avg(recent5);
    if (drop >= 15) { score += 35; flags.push(`Score drop ${Math.round(drop)}pp`); }
    else if (drop >= 8) { score += 18; flags.push(`Score dip ${Math.round(drop)}pp`); }
  }

  // Missing submissions (gap in last 7 days)
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const recentCount = subs.filter(s => s.submittedAt >= cutoff).length;
  if (recentCount === 0) { score += 30; flags.push('No activity in 7 days'); }
  else if (recentCount < 3) { score += 15; flags.push('Low activity this week'); }

  // Hint overuse
  const hintRate = subs.length ? subs.reduce((a, s) => a + (s.hintsUsed || 0), 0) / subs.length : 0;
  if (hintRate > HINT_OVERUSE) { score += 15; flags.push(`High hint usage (${hintRate.toFixed(1)})`); }

  // Misconception cluster (checked via student model)
  const student = await Student.findById(studentId).select('misconceptions').lean();
  const activeMisconceptions = (student?.misconceptions || []).filter(m => !m.resolved);
  if (activeMisconceptions.length >= 2) { score += 20; flags.push(`${activeMisconceptions.length} active misconceptions`); }
  else if (activeMisconceptions.length === 1) { score += 10; flags.push('1 active misconception'); }

  const riskLevel = score >= RISK_HIGH ? 'high' : score >= RISK_MEDIUM ? 'medium' : 'low';
  return { riskScore: Math.min(100, score), riskLevel, riskFlags: flags };
}

// ─── FULL STUDENT KPI RECOMPUTE ────────────────────────────────────────────────
async function recomputeStudentKPIs(studentId, courseId) {
  const [mastery, engagement, consistency, improvementRate, successProbability, risk] = await Promise.all([
    computeTopicMastery(studentId),
    computeEngagement(studentId, courseId),
    computeConsistency(studentId),
    computeImprovementRate(studentId),
    computeSuccessProbability(studentId, courseId),
    computeRisk(studentId, courseId),
  ]);

  await Student.findByIdAndUpdate(studentId, {
    topicMastery: mastery,
    'kpi.successProbability': successProbability,
    'kpi.engagementScore':    engagement,
    'kpi.consistencyScore':   consistency,
    'kpi.improvementRate':    improvementRate,
    'kpi.riskLevel':          risk.riskLevel,
    'kpi.riskScore':          risk.riskScore,
    'kpi.riskFlags':          risk.riskFlags,
  });

  return { mastery, engagement, consistency, improvementRate, successProbability, ...risk };
}

// ─── CLASS-LEVEL KPI SNAPSHOT ─────────────────────────────────────────────────
async function computeAndSaveClassSnapshot(courseId, studentIds) {
  const students = await Student.find({ _id: { $in: studentIds } }).lean();
  if (!students.length) return null;

  const kpis = students.map(s => s.kpi || {});
  const avgEngagement   = kpis.reduce((a, k) => a + (k.engagementScore || 50), 0) / kpis.length;
  const atRiskCount     = kpis.filter(k => k.riskLevel === 'high').length;

  // Average topic mastery across all students
  const topicTotals = {};
  const topicCounts = {};
  for (const s of students) {
    for (const [topic, val] of Object.entries(s.topicMastery || {})) {
      topicTotals[topic] = (topicTotals[topic] || 0) + val;
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    }
  }
  const topicBreakdown = {};
  for (const t of Object.keys(topicTotals)) {
    topicBreakdown[t] = Math.round((topicTotals[t] / topicCounts[t]) * 100) / 100;
  }

  const topicValues = Object.values(topicBreakdown);
  const avgTopicMastery = topicValues.length
    ? topicValues.reduce((a, b) => a + b, 0) / topicValues.length
    : 0;

  const snap = await KPISnapshot.create({
    course:          courseId,
    classAvgScore:   Math.round(avgTopicMastery * 100),
    atRiskCount,
    avgTopicMastery: Math.round(avgTopicMastery * 100) / 100,
    avgEngagement:   Math.round(avgEngagement),
    topicBreakdown,
  });

  return snap;
}

module.exports = {
  recomputeStudentKPIs,
  computeAndSaveClassSnapshot,
  computeTopicMastery,
  computeEngagement,
  computeConsistency,
  computeImprovementRate,
  computeSuccessProbability,
  computeRisk,
};

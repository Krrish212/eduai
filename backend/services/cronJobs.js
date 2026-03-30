const cron = require('node-cron');
const { Student, Course, Submission } = require('../models');
const { recomputeStudentKPIs, computeAndSaveClassSnapshot } = require('./kpiEngine');
const { detectMisconceptions } = require('./aiService');

/**
 * Scheduled jobs:
 *   Every 15 min  — recompute KPIs for students with new activity
 *   Every 1 hour  — run misconception scan on recent wrong answers
 *   Every night   — save class KPI snapshot for historical analytics
 */

// Track which students have had new submissions (set populated by submission route)
const dirtyStudents = new Set();
const dirtyStudentCourses = new Map();

function markStudentDirty(studentId, courseId) {
  dirtyStudents.add(studentId.toString());
  dirtyStudentCourses.set(studentId.toString(), courseId.toString());
}

// ─── JOB 1: KPI recompute every 15 minutes ────────────────────────────────────
cron.schedule('*/15 * * * *', async () => {
  if (!dirtyStudents.size) return;

  const ids = [...dirtyStudents];
  dirtyStudents.clear();
  console.log(`[CRON] Recomputing KPIs for ${ids.length} students`);

  for (const studentId of ids) {
    try {
      const courseId = dirtyStudentCourses.get(studentId);
      await recomputeStudentKPIs(studentId, courseId);
    } catch (err) {
      console.error(`[CRON] KPI error for ${studentId}:`, err.message);
    }
  }
});

// ─── JOB 2: Misconception scan every hour ─────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Running hourly misconception scan');
  try {
    const cutoff = new Date(Date.now() - 2 * 3600 * 1000); // last 2 hours
    const wrongSubs = await Submission.find({
      isCorrect: false,
      submittedAt: { $gte: cutoff },
      response: { $exists: true, $ne: '' },
    })
    .populate('student', 'name')
    .limit(50)
    .lean();

    // Group by student
    const byStudent = {};
    for (const s of wrongSubs) {
      const id = s.student._id.toString();
      if (!byStudent[id]) byStudent[id] = [];
      byStudent[id].push({
        topic:        s.topic,
        questionText: s.questionText,
        response:     s.response,
        correctAnswer:'(see question)',
      });
    }

    for (const [studentId, answers] of Object.entries(byStudent)) {
      if (answers.length >= 2) {  // only scan if 2+ wrong answers to analyse
        await detectMisconceptions(studentId, answers);
      }
    }
  } catch (err) {
    console.error('[CRON] Misconception scan error:', err.message);
  }
});

// ─── JOB 3: Nightly class snapshot at 23:30 ───────────────────────────────────
cron.schedule('30 23 * * *', async () => {
  console.log('[CRON] Saving nightly class KPI snapshots');
  try {
    const courses = await Course.find().lean();
    for (const course of courses) {
      const students = await Student.find({ courses: course._id }).select('_id').lean();
      if (students.length) {
        await computeAndSaveClassSnapshot(course._id, students.map(s => s._id));
      }
    }
  } catch (err) {
    console.error('[CRON] Snapshot error:', err.message);
  }
});

module.exports = { markStudentDirty };

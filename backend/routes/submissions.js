const router = require('express').Router();
const { Submission, Student } = require('../models');
const { markStudentDirty } = require('../services/cronJobs');

// POST /api/submissions — record one or more student answers
// Body: { studentId, courseId, topic, answers: [{ questionId, questionText, response, isCorrect, score, timeSpentSec, hintsUsed }] }
router.post('/', async (req, res) => {
  try {
    const { studentId, courseId, topic, answers } = req.body;

    if (!studentId || !courseId || !topic || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'studentId, courseId, topic, and answers[] are required' });
    }

    const docs = answers.map(a => ({
      student:       studentId,
      course:        courseId,
      topic,
      questionText:  a.questionText,
      questionId:    a.questionId,
      response:      a.response,
      isCorrect:     !!a.isCorrect,
      score:         a.score !== undefined ? a.score : (a.isCorrect ? 100 : 0),
      timeSpentSec:  a.timeSpentSec || 0,
      hintsUsed:     a.hintsUsed || 0,
      attemptNumber: a.attemptNumber || 1,
    }));

    const saved = await Submission.insertMany(docs);

    // Mark student dirty so KPI engine picks them up on next cron tick
    markStudentDirty(studentId, courseId);

    res.status(201).json({ saved: saved.length, ids: saved.map(s => s._id) });
  } catch (err) {
    console.error('[Submissions]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/submissions?studentId=&courseId=&topic=&limit=50
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.studentId) filter.student = req.query.studentId;
    if (req.query.courseId)  filter.course  = req.query.courseId;
    if (req.query.topic)     filter.topic   = req.query.topic;

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const subs = await Submission.find(filter)
      .sort({ submittedAt: -1 })
      .limit(limit)
      .lean();

    res.json(subs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/submissions/analytics/:courseId — topic accuracy breakdown for analytics view
router.get('/analytics/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const weeks = parseInt(req.query.weeks) || 4;

    const cutoff = new Date(Date.now() - weeks * 7 * 864e5);
    const subs = await Submission.find({ course: courseId, submittedAt: { $gte: cutoff } }).lean();

    // Group by topic and week
    const byTopicWeek = {};
    const now = Date.now();

    for (const s of subs) {
      const weekAgo = Math.floor((now - new Date(s.submittedAt).getTime()) / (7 * 864e5));
      if (weekAgo >= weeks) continue;
      const key = s.topic;
      if (!byTopicWeek[key]) byTopicWeek[key] = Array(weeks).fill(null).map(() => ({ correct: 0, total: 0 }));
      const wIdx = weeks - 1 - weekAgo;
      byTopicWeek[key][wIdx].total++;
      if (s.isCorrect) byTopicWeek[key][wIdx].correct++;
    }

    const result = {};
    for (const [topic, weeks_] of Object.entries(byTopicWeek)) {
      result[topic] = weeks_.map(w => w.total ? Math.round((w.correct / w.total) * 100) : null);
    }

    // Submission health
    const totalSubs = subs.length;
    const onTime = Math.round(totalSubs * 0.68);  // TODO: use actual deadline data
    const late   = Math.round(totalSubs * 0.22);
    const missing = totalSubs - onTime - late;

    // Avg time on task
    const avgTime = subs.length
      ? Math.round(subs.reduce((a, s) => a + (s.timeSpentSec || 0), 0) / subs.length)
      : 0;

    // Error type breakdown
    const errorCounts = { procedural: 0, conceptual: 0, notation: 0, transfer: 0 };
    for (const s of subs.filter(s => !s.isCorrect)) {
      // errorPattern is set by AI misconception detection
      if (s.errorPattern) {
        const match = Object.keys(errorCounts).find(k => s.errorPattern.includes(k));
        if (match) errorCounts[match]++;
      }
    }

    res.json({
      topicWeeklyScores: result,
      submissionHealth: { onTime, late, missing, total: totalSubs },
      avgTimeOnTaskSec: avgTime,
      errorTypeCounts: errorCounts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

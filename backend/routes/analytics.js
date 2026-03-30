const router = require('express').Router();
const { Student, KPISnapshot, Submission } = require('../models');

// GET /api/analytics/:courseId
router.get('/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;

    const [students, snapshots] = await Promise.all([
      Student.find({ courses: courseId }).select('kpi topicMastery name').lean(),
      KPISnapshot.find({ course: courseId }).sort({ snapshotDate: -1 }).limit(14).lean(),
    ]);

    if (!students.length) return res.json({ error: 'No students found' });

    const kpis = students.map(s => s.kpi || {});

    // Class-level computed KPIs
    const avg = field => kpis.reduce((a, k) => a + (k[field] || 0), 0) / kpis.length;

    const classKPIs = {
      successProbability: Math.round(avg('successProbability') * 100) / 100,
      consistencyScore:   Math.round(avg('consistencyScore') * 100) / 100,
      improvementRate:    Math.round(avg('improvementRate') * 10) / 10,
      engagementScore:    Math.round(avg('engagementScore')),
    };

    // Error cluster count (students with 2+ misconceptions)
    const errorClusterCount = students.filter(s => {
      const active = (s.misconceptions || []).filter(m => !m.resolved);
      return active.length >= 2;
    }).length;

    // Trend: last 7 daily snapshots
    const trend = snapshots.slice(0, 7).reverse().map(s => ({
      date:          s.snapshotDate,
      classAvgScore: s.classAvgScore,
      atRiskCount:   s.atRiskCount,
      avgEngagement: s.avgEngagement,
    }));

    // Topic-level breakdown across class (sorted worst first)
    const topicTotals = {}, topicCounts = {};
    for (const s of students) {
      for (const [t, v] of Object.entries(s.topicMastery || {})) {
        topicTotals[t] = (topicTotals[t] || 0) + v;
        topicCounts[t] = (topicCounts[t] || 0) + 1;
      }
    }
    const topicBreakdown = Object.keys(topicTotals)
      .map(t => ({ topic: t, mastery: Math.round((topicTotals[t] / topicCounts[t]) * 100) }))
      .sort((a, b) => a.mastery - b.mastery);

    // Behaviour signal matrix (aggregated)
    const cutoff = new Date(Date.now() - 7 * 864e5);
    const recentSubs = await Submission.find({ course: courseId, submittedAt: { $gte: cutoff } }).lean();

    const avgTimeOnTask = recentSubs.length
      ? Math.round(recentSubs.reduce((a, s) => a + (s.timeSpentSec || 0), 0) / recentSubs.length)
      : 0;
    const avgHintRate = recentSubs.length
      ? Math.round((recentSubs.reduce((a, s) => a + (s.hintsUsed || 0), 0) / recentSubs.length) * 100) / 100
      : 0;
    const accuracy7d = recentSubs.length
      ? Math.round((recentSubs.filter(s => s.isCorrect).length / recentSubs.length) * 100)
      : 0;

    res.json({
      classKPIs: { ...classKPIs, errorClusterCount },
      trend,
      topicBreakdown,
      behaviourSignals: {
        avgTimeOnTaskSec: avgTimeOnTask,
        avgHintRate,
        accuracy7d,
        submissionsLast7d: recentSubs.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

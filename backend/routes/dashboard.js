const router = require('express').Router();
const { Student, Course, KPISnapshot, AIQueueItem } = require('../models');

// GET /api/dashboard/:courseId
// Returns everything the teacher dashboard needs in one call
router.get('/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;

    const [course, students, latestSnapshot, pendingQueue] = await Promise.all([
      Course.findById(courseId).lean(),
      Student.find({ courses: courseId })
        .select('name initials topicMastery kpi misconceptions')
        .lean(),
      KPISnapshot.findOne({ course: courseId }).sort({ snapshotDate: -1 }).lean(),
      AIQueueItem.countDocuments({ course: courseId, status: 'pending' }),
    ]);

    if (!course) return res.status(404).json({ error: 'Course not found' });

    // ── Class-level KPIs ──
    const kpis = students.map(s => s.kpi || {});
    const classAvgEngagement = kpis.length
      ? Math.round(kpis.reduce((a, k) => a + (k.engagementScore || 50), 0) / kpis.length)
      : 50;
    const atRiskStudents = students.filter(s => (s.kpi?.riskLevel) === 'high');
    const atRiskMedium   = students.filter(s => (s.kpi?.riskLevel) === 'medium');

    // Average topic mastery across class
    const topicTotals = {}, topicCounts = {};
    for (const s of students) {
      for (const [topic, val] of Object.entries(s.topicMastery || {})) {
        topicTotals[topic] = (topicTotals[topic] || 0) + val;
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      }
    }
    const topicMastery = {};
    for (const t of Object.keys(topicTotals)) {
      topicMastery[t] = Math.round((topicTotals[t] / topicCounts[t]) * 100);
    }
    const topicValues = Object.values(topicMastery);
    const avgTopicMastery = topicValues.length
      ? Math.round(topicValues.reduce((a, b) => a + b, 0) / topicValues.length)
      : 0;

    // ── Heatmap data ──
    const heatmap = students.map(s => ({
      studentId:   s._id,
      studentName: s.name,
      initials:    s.initials,
      topics:      Object.fromEntries(
        Object.entries(s.topicMastery || {}).map(([k, v]) => [k, Math.round(v * 100)])
      ),
    }));

    // ── Risk table (sorted by riskScore desc) ──
    const riskTable = students
      .sort((a, b) => (b.kpi?.riskScore || 0) - (a.kpi?.riskScore || 0))
      .slice(0, 8)
      .map(s => ({
        studentId: s._id,
        name:      s.name,
        initials:  s.initials,
        riskScore: s.kpi?.riskScore || 0,
        riskLevel: s.kpi?.riskLevel || 'low',
        riskFlags: s.kpi?.riskFlags || [],
        engagement: s.kpi?.engagementScore || 50,
      }));

    // ── Historical snapshots (last 7) for trend ──
    const snapshots = await KPISnapshot.find({ course: courseId })
      .sort({ snapshotDate: -1 })
      .limit(7)
      .select('classAvgScore avgEngagement atRiskCount snapshotDate')
      .lean();

    res.json({
      course,
      kpis: {
        classAvgScore:    latestSnapshot?.classAvgScore || avgTopicMastery,
        atRiskCount:      atRiskStudents.length,
        atRiskMediumCount:atRiskMedium.length,
        avgTopicMastery,
        engagementScore:  classAvgEngagement,
        pendingQueue,
        topicMastery,
      },
      heatmap,
      riskTable,
      snapshots: snapshots.reverse(),
      totalStudents: students.length,
    });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

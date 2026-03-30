const router = require('express').Router();
const { Intervention, Student, AIQueueItem } = require('../models');

// GET /api/interventions/:courseId
router.get('/:courseId', async (req, res) => {
  try {
    const students = await Student.find({ courses: req.params.courseId })
      .select('name initials kpi misconceptions')
      .lean();

    const flagged = students
      .filter(s => ['high', 'medium'].includes(s.kpi?.riskLevel))
      .sort((a, b) => (b.kpi?.riskScore || 0) - (a.kpi?.riskScore || 0));

    const interventions = await Intervention.find({ course: req.params.courseId })
      .sort({ createdAt: -1 })
      .populate('student', 'name initials')
      .populate('aiQueueItem', 'type topic status')
      .lean();

    // Outcome stats
    const resolved = interventions.filter(i => i.status === 'resolved');
    const scoreRecovery = resolved.length
      ? resolved.filter(i => (i.outcome?.scoreChange || 0) > 0).length / resolved.length
      : 0;

    res.json({
      flaggedStudents: flagged.map(s => ({
        studentId:  s._id,
        name:       s.name,
        initials:   s.initials,
        riskScore:  s.kpi?.riskScore || 0,
        riskLevel:  s.kpi?.riskLevel || 'low',
        riskFlags:  s.kpi?.riskFlags || [],
        topMisconception: (s.misconceptions || []).filter(m => !m.resolved)[0]?.label || null,
      })),
      interventions,
      outcomeStats: {
        total:      interventions.length,
        resolved:   resolved.length,
        scoreRecoveryRate: Math.round(scoreRecovery * 100),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/interventions — create an intervention record (links student to an AI queue item)
router.post('/', async (req, res) => {
  try {
    const { studentId, courseId, riskScore, riskFlags, recommendation, aiQueueItemId } = req.body;
    const iv = await Intervention.create({
      student:       studentId,
      course:        courseId,
      riskSnapshot:  { riskScore, riskFlags },
      recommendation,
      aiQueueItem:   aiQueueItemId || null,
      status:        'open',
    });
    res.status(201).json(iv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/interventions/:id/outcome — record measured outcome after 4 weeks
router.patch('/:id/outcome', async (req, res) => {
  try {
    const { scoreChange, engagementChange, resolved } = req.body;
    const iv = await Intervention.findByIdAndUpdate(req.params.id, {
      outcome: { scoreChange, engagementChange, resolved, measuredAt: new Date() },
      status: resolved ? 'resolved' : 'no_change',
    }, { new: true });
    res.json(iv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

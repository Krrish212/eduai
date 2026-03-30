const router = require('express').Router();
const { Student, Submission, Intervention } = require('../models');
const { recomputeStudentKPIs } = require('../services/kpiEngine');
const { markStudentDirty } = require('../services/cronJobs');

// GET /api/students?courseId=xxx
router.get('/', async (req, res) => {
  try {
    const filter = req.query.courseId ? { courses: req.query.courseId } : {};
    const students = await Student.find(filter)
      .select('name initials email topicMastery kpi misconceptions courses')
      .lean();
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/students/:id
router.get('/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const [submissions, interventions] = await Promise.all([
      Submission.find({ student: req.params.id })
        .sort({ submittedAt: -1 })
        .limit(50)
        .lean(),
      Intervention.find({ student: req.params.id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('aiQueueItem', 'type topic content')
        .lean(),
    ]);

    // Weekly score breakdown (last 4 weeks)
    const now = Date.now();
    const weeklyScores = [0,1,2,3].map(w => {
      const wSubs = submissions.filter(s => {
        const age = now - new Date(s.submittedAt).getTime();
        return age >= w*7*864e5 && age < (w+1)*7*864e5;
      });
      return {
        weekLabel: w === 0 ? 'This week' : `${w}w ago`,
        avgScore: wSubs.length
          ? Math.round(wSubs.reduce((a, s) => a + (s.score || (s.isCorrect ? 100 : 0)), 0) / wSubs.length)
          : null,
        count: wSubs.length,
      };
    }).reverse();

    res.json({ student, submissions, interventions, weeklyScores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/students — create student
router.post('/', async (req, res) => {
  try {
    const { name, email, courseIds } = req.body;
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const student = await Student.create({
      name, email, initials,
      courses: courseIds || [],
    });
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/students/:id/recompute — force KPI recompute
router.post('/:id/recompute', async (req, res) => {
  try {
    const { courseId } = req.body;
    const result = await recomputeStudentKPIs(req.params.id, courseId);
    res.json({ success: true, kpi: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

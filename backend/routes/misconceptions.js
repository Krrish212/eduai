const router = require('express').Router();
const { Student } = require('../models');
const { detectMisconceptions } = require('../services/aiService');

// GET /api/misconceptions/:courseId — all active misconceptions for a class
router.get('/:courseId', async (req, res) => {
  try {
    const students = await Student.find({ courses: req.params.courseId })
      .select('name initials misconceptions')
      .lean();

    // Aggregate misconceptions across students
    const clusters = {};
    for (const s of students) {
      for (const m of (s.misconceptions || []).filter(m => !m.resolved)) {
        const key = m.label || m.errorPattern || m.topic;
        if (!clusters[key]) {
          clusters[key] = {
            label:      m.label,
            topic:      m.topic,
            errorType:  m.errorType,
            severity:   m.severity,
            students:   [],
            frequency:  0,
            firstSeen:  m.detectedAt,
          };
        }
        clusters[key].students.push({ id: s._id, name: s.name, initials: s.initials });
        clusters[key].frequency += m.frequency || 1;
        if (new Date(m.detectedAt) < new Date(clusters[key].firstSeen)) {
          clusters[key].firstSeen = m.detectedAt;
        }
      }
    }

    const list = Object.values(clusters)
      .sort((a, b) => {
        const sev = { high: 3, medium: 2, low: 1 };
        return (sev[b.severity] || 0) - (sev[a.severity] || 0) || b.students.length - a.students.length;
      })
      .map(c => ({ ...c, affectedCount: c.students.length }));

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/misconceptions/scan — manually trigger AI misconception scan for a student
router.post('/scan', async (req, res) => {
  try {
    const { studentId, wrongAnswers } = req.body;
    if (!studentId || !Array.isArray(wrongAnswers)) {
      return res.status(400).json({ error: 'studentId and wrongAnswers[] required' });
    }
    const detected = await detectMisconceptions(studentId, wrongAnswers);
    res.json({ detected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/misconceptions/:studentId/:misconceptionIndex/resolve
router.patch('/:studentId/:idx/resolve', async (req, res) => {
  try {
    const student = await Student.findById(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const idx = parseInt(req.params.idx);
    if (student.misconceptions[idx]) {
      student.misconceptions[idx].resolved = true;
    }
    await student.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

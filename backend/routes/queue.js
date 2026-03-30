const router = require('express').Router();
const { AIQueueItem, Student, Course } = require('../models');
const { createQueueItem } = require('../services/aiService');

// GET /api/queue?courseId=&status=pending
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.courseId) filter.course = req.query.courseId;
    if (req.query.status)   filter.status = req.query.status;
    else filter.status = 'pending';

    const items = await AIQueueItem.find(filter)
      .sort({ createdAt: -1 })
      .populate('targetStudent', 'name initials')
      .populate('targetGroup', 'name initials')
      .lean();

    const stats = await AIQueueItem.aggregate([
      { $match: { course: filter.course ? require('mongoose').Types.ObjectId.createFromHexString(filter.course) : { $exists: true } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const statusCounts = { pending: 0, approved: 0, edited_approved: 0, rejected: 0 };
    stats.forEach(s => { statusCounts[s._id] = s.count; });

    res.json({ items, statusCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/queue/generate — ask AI to generate a new item
router.post('/generate', async (req, res) => {
  try {
    const {
      type, courseId, studentId, studentIds, topic,
      difficulty, misconceptionLabel, errorType, curriculumRef
    } = req.body;

    if (!type || !courseId || !topic) {
      return res.status(400).json({ error: 'type, courseId, topic required' });
    }

    let studentName;
    if (studentId) {
      const s = await Student.findById(studentId).select('name').lean();
      studentName = s?.name;
    }

    const item = await createQueueItem({
      type, courseId, studentId, studentIds, studentName,
      topic, difficulty, misconceptionLabel, errorType, curriculumRef,
    });

    res.status(201).json(item);
  } catch (err) {
    console.error('[Queue/generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/queue/:id/approve
router.patch('/:id/approve', async (req, res) => {
  try {
    const { teacherEdits } = req.body;
    const status = teacherEdits ? 'edited_approved' : 'approved';
    const item = await AIQueueItem.findByIdAndUpdate(req.params.id, {
      status,
      teacherEdits: teacherEdits || null,
      reviewedAt: new Date(),
    }, { new: true });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/queue/:id/reject
router.patch('/:id/reject', async (req, res) => {
  try {
    const item = await AIQueueItem.findByIdAndUpdate(req.params.id, {
      status: 'rejected',
      reviewedAt: new Date(),
    }, { new: true });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/queue/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await AIQueueItem.findById(req.params.id)
      .populate('targetStudent', 'name initials topicMastery')
      .populate('targetGroup', 'name initials')
      .lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

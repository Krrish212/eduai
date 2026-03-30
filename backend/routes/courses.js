const router = require('express').Router();
const { Course, Student } = require('../models');
const { studentChatResponse } = require('../services/aiService');

// ─── COURSES ──────────────────────────────────────────────────────────────────

// GET /api/courses
router.get('/', async (req, res) => {
  try {
    const courses = await Course.find().lean();
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/courses/:id
router.get('/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ error: 'Not found' });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/courses
router.post('/', async (req, res) => {
  try {
    const course = await Course.create(req.body);
    res.status(201).json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── STUDENT CHAT (mounted at /api/chat) ─────────────────────────────────────

const chatRouter = require('express').Router();

// POST /api/chat
chatRouter.post('/', async (req, res) => {
  try {
    const { studentId, topic, question, conversationHistory } = req.body;
    if (!studentId || !topic || !question) {
      return res.status(400).json({ error: 'studentId, topic, question required' });
    }

    const student = await Student.findById(studentId).select('name topicMastery').lean();
    const masteryLevel = student?.topicMastery?.[topic]
      ? Math.round(student.topicMastery[topic] * 100)
      : null;

    const reply = await studentChatResponse({
      studentName: student?.name,
      topic,
      question,
      conversationHistory: conversationHistory || [],
      masteryLevel,
    });

    res.json({ reply });
  } catch (err) {
    console.error('[Chat]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { coursesRouter: router, chatRouter };

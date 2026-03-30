/**
 * api.js — thin fetch wrapper for all EduAI backend endpoints.
 * All functions return parsed JSON or throw an Error.
 */

const API = (() => {
  const BASE = '/api';

  async function request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const get  = (path)        => request('GET',   path);
  const post = (path, body)  => request('POST',  path, body);
  const patch= (path, body)  => request('PATCH', path, body);

  return {
    // Courses
    getCourses:      ()   => get('/courses'),
    getCourse:       (id) => get(`/courses/${id}`),

    // Dashboard
    getDashboard:    (courseId) => get(`/dashboard/${courseId}`),

    // Analytics
    getAnalytics:    (courseId) => get(`/analytics/${courseId}`),

    // Students
    getStudents:     (courseId) => get(`/students?courseId=${courseId}`),
    getStudent:      (id)       => get(`/students/${id}`),
    recomputeKPIs:   (id, courseId) => post(`/students/${id}/recompute`, { courseId }),

    // Submissions
    postSubmissions: (payload)  => post('/submissions', payload),
    getSubmissions:  (params)   => get(`/submissions?${new URLSearchParams(params)}`),
    getSubmissionAnalytics: (courseId, weeks) =>
      get(`/submissions/analytics/${courseId}?weeks=${weeks || 4}`),

    // Misconceptions
    getMisconceptions: (courseId) => get(`/misconceptions/${courseId}`),
    scanMisconceptions:(studentId, wrongAnswers) =>
      post('/misconceptions/scan', { studentId, wrongAnswers }),
    resolveMisconception:(studentId, idx) =>
      patch(`/misconceptions/${studentId}/${idx}/resolve`),

    // Interventions
    getInterventions:  (courseId) => get(`/interventions/${courseId}`),
    createIntervention:(payload)  => post('/interventions', payload),
    recordOutcome:     (id, outcome) => patch(`/interventions/${id}/outcome`, outcome),

    // AI Queue
    getQueue:      (courseId, status) =>
      get(`/queue?courseId=${courseId}${status ? '&status='+status : ''}`),
    generateItem:  (payload)    => post('/queue/generate', payload),
    approveItem:   (id, edits)  => patch(`/queue/${id}/approve`, { teacherEdits: edits || null }),
    rejectItem:    (id)         => patch(`/queue/${id}/reject`),

    // Chat
    chat: (studentId, topic, question, history) =>
      post('/chat', { studentId, topic, question, conversationHistory: history }),

    // Health
    health: () => get('/health'),
  };
})();

window.API = API;

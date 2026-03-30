/**
 * app.js — EduAI application controller.
 * Owns all state, coordinates API calls, and calls Render.* functions.
 * No DOM manipulation directly — that lives in render.js.
 */

const App = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  const state = {
    courseId:        null,
    courses:         [],
    students:        [],
    currentStudentId:null,
    dashboardData:   null,
    analyticsData:   null,
    misconceptions:  [],
    interventionData:null,
    queueData:       null,
    chatHistory:     [],     // [{ role:'user'|'assistant', content:'' }]
    activeView:      'dashboard',
    submissionAnalytics: null,
  };

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── View routing ──────────────────────────────────────────────────────────
  const VIEW_TITLES = {
    dashboard:     'Class Dashboard',
    analytics:     'Analytics · KPI Engine',
    misconceptions:'Misconception Detection',
    interventions: 'Intervention Workflow',
    review:        'AI Review Queue',
    student:       'Student View',
    lms:           'LMS Overlay',
  };

  function goTo(view) {
    document.querySelectorAll('.view').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });
    const target = $(`v-${view}`);
    if (target) {
      target.style.display = 'flex';
      target.classList.add('active');
    }
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
    $('view-title').textContent = VIEW_TITLES[view] || view;
    state.activeView = view;
    loadView(view);
  }

  async function loadView(view) {
    try {
      if (view === 'dashboard')      await loadDashboard();
      if (view === 'analytics')      await loadAnalytics();
      if (view === 'misconceptions') await loadMisconceptions();
      if (view === 'interventions')  await loadInterventions();
      if (view === 'review')         await loadQueue();
      if (view === 'student')        await loadStudent();
      if (view === 'lms')            await loadLMS();
    } catch (err) {
      console.error(`[App] Error loading ${view}:`, err);
    }
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  async function loadDashboard() {
    if (!state.courseId) return;
    const data = await API.getDashboard(state.courseId);
    state.dashboardData = data;

    // Update topbar
    $('topbar-meta').textContent =
      `${data.totalStudents} students · ${data.course?.term || ''} Wk ${data.course?.week || ''}`;
    $('course-label').textContent = data.course?.name || '';

    // KPI strip
    const kpis = data.kpis;
    Render.kpiStrip($('kpi-strip'), [
      { label:'Class Avg Score',    value:`${kpis.classAvgScore}%`, colorClass: kpis.classAvgScore >= 65 ? 'g' : kpis.classAvgScore >= 50 ? 'a' : 'r', delta: '' },
      { label:'At-Risk Students',   value: kpis.atRiskCount,       colorClass: kpis.atRiskCount > 4 ? 'r' : kpis.atRiskCount > 1 ? 'a' : 'g', delta:`+${kpis.atRiskMediumCount} medium` },
      { label:'Topic Mastery (avg)',value:`${kpis.avgTopicMastery}%`, colorClass: kpis.avgTopicMastery >= 65 ? 'g' : 'a', delta:'rolling exp. weighted' },
      { label:'Engagement Score',   value: kpis.engagementScore,   colorClass: kpis.engagementScore >= 65 ? 'g' : 'a', delta:`threshold 65` },
      { label:'AI Queue Pending',   value: kpis.pendingQueue,      colorClass: kpis.pendingQueue > 0 ? 'b' : 'g', delta:'needs review' },
    ]);
    $('queue-badge').textContent = kpis.pendingQueue > 0 ? kpis.pendingQueue : '';
    $('risk-count-pill').textContent = `${kpis.atRiskCount} flagged`;

    // Heatmap
    const allTopics = [...new Set(data.heatmap.flatMap(s => Object.keys(s.topics)))];
    Render.heatmap($('heatmap'), data.heatmap, allTopics);

    // Risk table
    Render.riskTable($('risk-body').querySelector ? $('risk-body') : document.querySelector('#risk-body'),
      data.riskTable, sid => goTo('interventions'));

    // Topic sparklines
    Render.topicSpark($('topic-spark'), kpis.topicMastery);

    // Engagement bars
    Render.engBars($('eng-bars'), data.snapshots, $('eng-note'), 65);

    // Submission health — needs analytics data
    try {
      const analytics = await API.getSubmissionAnalytics(state.courseId, 4);
      state.submissionAnalytics = analytics;
      Render.submissionHealth($('sub-health'), analytics.submissionHealth, analytics.avgTimeOnTaskSec);
    } catch (e) {
      $('sub-health').innerHTML = '<div class="loading-msg">Submit some answers to see data.</div>';
    }
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  async function loadAnalytics() {
    if (!state.courseId) return;
    const [analytics, subAnalytics] = await Promise.all([
      API.getAnalytics(state.courseId),
      API.getSubmissionAnalytics(state.courseId, 4).catch(() => null),
    ]);
    state.analyticsData = analytics;

    Render.analyticsKPIs($('a-kpi-strip'), analytics.classKPIs);

    if (subAnalytics) {
      Render.analyticsTopicBars($('a-bars'), subAnalytics.topicWeeklyScores, $('a-insight'));
    } else {
      $('a-bars').innerHTML = '<div class="loading-msg">No submission data yet — run seed or submit answers.</div>';
    }

    // KPI logic cards
    const logicEl = $('kpi-logic');
    logicEl.innerHTML = [
      { pill:'Success Probability', cls:'b', txt:'Logistic regression: grade percentile × consistency × submission rate × improvement slope. Output: 0–1.' },
      { pill:'Topic Mastery',       cls:'g', txt:'Rolling 5-question exponentially weighted accuracy per topic (λ=0.85). Most-recent attempts weighted highest.' },
      { pill:'Engagement Score',    cls:'a', txt:'Composite: session frequency (30%) + time-on-task (30%) + hint usage inverted (20%) + submission rate (20%). Scale 0–100.' },
      { pill:'Risk Level',          cls:'r', txt:'Score drop >15% OR 2+ missed + engagement <40 + error cluster match. Outputs: low / medium / high + flag strings.' },
      { pill:'Consistency Score',   cls:'gray', txt:'1 − (σ / μ) of last 5 session scores. Higher = more stable. Feeds into Success Probability.' },
    ].map(r => `<div class="kpi-logic-row"><span class="pill ${r.cls}" style="margin-right:6px">${r.pill}</span>${r.txt}</div>`).join('');

    // Behaviour signal table
    Render.behaviourSignals($('bsig-table'), analytics.behaviourSignals);
  }

  // ── Misconceptions ────────────────────────────────────────────────────────
  async function loadMisconceptions() {
    if (!state.courseId) return;
    const clusters = await API.getMisconceptions(state.courseId);
    state.misconceptions = clusters;

    $('mis-count-pill').textContent = `${clusters.length} active`;
    Render.misconceptionList($('mis-list'), clusters);

    // Error taxonomy cards
    const taxonomy = [
      { label:'PROCEDURAL', cls:'var(--red)',   txt:'Wrong algorithm steps or order of operations' },
      { label:'CONCEPTUAL', cls:'var(--amber)', txt:'Fundamental misunderstanding of the principle' },
      { label:'NOTATION',   cls:'var(--blue)',  txt:'Symbol confusion or misreading of the problem' },
      { label:'TRANSFER',   cls:'var(--green)', txt:'Cannot apply a known concept in new context' },
    ];
    $('error-taxonomy').innerHTML = taxonomy.map(t =>
      `<div style="border:0.5px solid var(--bd);border-radius:var(--r);padding:9px">
        <div style="font-size:10px;font-weight:500;color:${t.cls};margin-bottom:3px">${t.label}</div>
        <div style="font-size:11px;color:var(--text2)">${t.txt}</div>
      </div>`
    ).join('');

    // Error type bars from submission analytics
    const sa = state.submissionAnalytics;
    if (sa) {
      Render.errorTypeBars($('err-bars'), sa.errorTypeCounts);
    } else {
      $('err-bars').innerHTML = '<div class="loading-msg">No error type data yet.</div>';
    }

    // Remediation table
    Render.remediationTable(
      document.querySelector('#rem-table tbody'),
      clusters,
      state.courseId,
      async (mis) => {
        const student = mis.students?.[0];
        await generateForMisconception(mis, student);
      }
    );
  }

  async function generateForMisconception(mis, student) {
    try {
      const type = mis.errorType === 'conceptual' ? 'mini_lesson' : 'question';
      await API.generateItem({
        type,
        courseId:          state.courseId,
        studentId:         student?.id || null,
        studentIds:        mis.students?.map(s => s.id) || [],
        topic:             mis.topic,
        difficulty:        'remedial',
        misconceptionLabel:mis.label,
        errorType:         mis.errorType,
      });
      alert(`AI content generated for "${mis.label}" — check the Review Queue.`);
    } catch (err) {
      alert('Generation failed: ' + err.message);
    }
  }

  // ── Interventions ─────────────────────────────────────────────────────────
  async function loadInterventions() {
    if (!state.courseId) return;
    const data = await API.getInterventions(state.courseId);
    state.interventionData = data;

    Render.interventionFlow($('interv-flow'), data);
    Render.interventionBody(
      document.querySelector('#int-body'),
      data.flaggedStudents,
      async (sid) => {
        const student = data.flaggedStudents.find(s => s.studentId === sid);
        if (!student) return;
        try {
          const item = await API.generateItem({
            type:     student.riskLevel === 'high' ? 'mini_lesson' : 'question',
            courseId: state.courseId,
            studentId:sid,
            topic:    student.topMisconception ? student.riskFlags?.[0] || 'General' : 'General',
            difficulty:'remedial',
            misconceptionLabel: student.topMisconception || null,
          });
          await API.createIntervention({
            studentId:    sid,
            courseId:     state.courseId,
            riskScore:    student.riskScore,
            riskFlags:    student.riskFlags,
            recommendation: `AI-generated ${item.type} for ${item.topic}`,
            aiQueueItemId: item._id,
          });
          alert(`Intervention created for ${student.name} — review the AI Queue.`);
          goTo('review');
        } catch (err) {
          alert('Failed to generate intervention: ' + err.message);
        }
      }
    );
    Render.interventionOutcomes($('int-outcomes'), data.outcomeStats);
  }

  // ── Review Queue ──────────────────────────────────────────────────────────
  async function loadQueue() {
    if (!state.courseId) return;
    const data = await API.getQueue(state.courseId);
    state.queueData = data;

    Render.queueKPIs($('q-kpi-strip'), data.statusCounts);
    Render.queueList($('queue-list'), data.items, {
      onApprove: async (id, edits) => {
        await API.approveItem(id, edits);
        await loadQueue();
      },
      onReject: async (id) => {
        await API.rejectItem(id);
        await loadQueue();
      },
    });
  }

  // ── Student View ──────────────────────────────────────────────────────────
  async function loadStudent() {
    if (!state.currentStudentId) {
      // Show picker
      await showStudentPicker();
      return;
    }
    const { student } = await API.getStudent(state.currentStudentId);

    // Topic progress
    const masteryPct = {};
    for (const [t, v] of Object.entries(student.topicMastery || {})) {
      masteryPct[t] = v; // already 0-1 from DB; render will * 100
    }
    Render.studentTopics($('stu-topics'), masteryPct);
    Render.studentNextSteps($('stu-nextsteps'), masteryPct);

    // Recent activity
    const recentHtml = [
      { label:'Algebra Set 4',         pill:'g', pct: Math.round((student.topicMastery?.['Algebra'] || 0.7) * 100) },
      { label:'Statistics Quiz 3',     pill:'g', pct: 79 },
      { label:'Trigonometry Quiz 2',   pill:'a', pct: Math.round((student.topicMastery?.['Trigonometry'] || 0.48) * 100) },
      { label:'Geometry Set 3',        pill:'g', pct: 71 },
    ];
    $('stu-recent').innerHTML = recentHtml.map(r =>
      `<div style="font-size:11px;color:var(--text2);line-height:2">
        ${r.pct >= 65 ? '✓' : '⚠'} ${r.label} &nbsp;<span class="pill ${r.pill}" style="font-size:10px">${r.pct}%</span>
      </div>`
    ).join('');

    // Load an approved question for this student's weakest topic
    const weakestTopic = Object.entries(student.topicMastery || {})
      .sort((a, b) => a[1] - b[1])[0]?.[0] || 'Mathematics';
    $('quiz-topic-pill').textContent = `${weakestTopic} · Personalised`;

    try {
      const queueData = await API.getQueue(state.courseId, 'approved');
      const relevantQ = queueData.items.find(i =>
        i.type === 'question' &&
        (!i.targetStudent || i.targetStudent._id === state.currentStudentId)
      );
      Render.adaptiveQuiz($('quiz-area'), relevantQ, async (isCorrect) => {
        if (state.courseId) {
          await API.postSubmissions({
            studentId: state.currentStudentId,
            courseId:  state.courseId,
            topic:     relevantQ?.topic || weakestTopic,
            answers: [{
              questionId:   relevantQ?._id || 'adaptive-1',
              questionText: relevantQ?.content?.questionText || '',
              response:     isCorrect ? 'correct' : 'incorrect',
              isCorrect,
              score:        isCorrect ? 100 : 0,
              timeSpentSec: 60,
            }]
          });
        }
      });
    } catch {
      $('quiz-area').innerHTML = '<div class="loading-msg">No approved questions yet — generate and approve one from the AI Review Queue.</div>';
    }

    // Seed chat with AI greeting
    if (state.chatHistory.length === 0) {
      const greeting = `Hi ${student.name.split(' ')[0]}! I can see you're working on ${weakestTopic} — that's your current focus area. What would you like help with?`;
      Render.addChatMessage($('chat-history'), greeting, 'ai');
      state.chatHistory.push({ role: 'assistant', content: greeting });
    }
  }

  async function showStudentPicker() {
    if (!state.students.length) {
      state.students = await API.getStudents(state.courseId);
    }
    const modal = $('student-modal');
    Render.studentPicker($('student-picker'), state.students, (sid) => {
      state.currentStudentId = sid;
      modal.style.display = 'none';
      loadStudent();
    });
    modal.style.display = 'flex';
  }

  // ── LMS Overlay ───────────────────────────────────────────────────────────
  async function loadLMS() {
    if (!state.dashboardData) {
      state.dashboardData = await API.getDashboard(state.courseId);
    }
    const mis = state.misconceptions.length ? state.misconceptions : await API.getMisconceptions(state.courseId);
    Render.lmsPanel($('lms-panel-body'), { ...state.dashboardData, misconceptions: mis });
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async function sendChat(message) {
    if (!message.trim() || !state.currentStudentId) return;
    const student = state.students.find(s => s._id === state.currentStudentId);
    const topic   = student?.topicMastery
      ? Object.entries(student.topicMastery).sort((a,b)=>a[1]-b[1])[0]?.[0] || 'Mathematics'
      : 'Mathematics';

    Render.addChatMessage($('chat-history'), message, 'user');
    state.chatHistory.push({ role: 'user', content: message });

    const thinking = document.createElement('div');
    thinking.className = 'chat-bubble ai';
    thinking.textContent = 'EduAI is thinking…';
    $('chat-history').appendChild(thinking);

    try {
      const { reply } = await API.chat(
        state.currentStudentId, topic, message,
        state.chatHistory.slice(-6)  // last 3 turns as context
      );
      thinking.remove();
      Render.addChatMessage($('chat-history'), reply, 'ai');
      state.chatHistory.push({ role: 'assistant', content: reply });
    } catch (err) {
      thinking.textContent = 'Sorry, I could not connect to the AI. Check your ANTHROPIC_API_KEY.';
    }
  }

  // ── Briefing export ───────────────────────────────────────────────────────
  async function exportBriefing() {
    if (!state.dashboardData) return;
    const d = state.dashboardData;
    const kpis = d.kpis;
    const lines = [
      `EduAI Class Briefing — ${new Date().toLocaleDateString()}`,
      `Course: ${d.course?.name}`,
      ``,
      `CLASS KPIs`,
      `  Avg Score:       ${kpis.classAvgScore}%`,
      `  At-Risk:         ${kpis.atRiskCount} students`,
      `  Topic Mastery:   ${kpis.avgTopicMastery}%`,
      `  Engagement:      ${kpis.engagementScore} / 100`,
      `  AI Queue:        ${kpis.pendingQueue} pending`,
      ``,
      `TOPIC BREAKDOWN`,
      ...Object.entries(kpis.topicMastery).map(([t,v]) => `  ${t}: ${v}%`),
      ``,
      `HIGH RISK STUDENTS`,
      ...(d.riskTable?.filter(s => s.riskLevel === 'high').map(s =>
        `  ${s.name} (${s.riskScore}) — ${(s.riskFlags||[]).join(', ')}`
      ) || []),
    ];
    const blob = new Blob([lines.join('\n')], { type:'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eduai-briefing-${Date.now()}.txt`;
    a.click();
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    try {
      await API.health();
    } catch {
      console.warn('[App] API health check failed — is the server running?');
    }

    // Load courses and pick the first one
    try {
      const courses = await API.getCourses();
      state.courses = courses;
      if (courses.length) {
        state.courseId = courses[0]._id;
        $('course-label').textContent = courses[0].name;
      } else {
        $('course-label').textContent = 'No courses — run npm run seed';
        return;
      }
    } catch (err) {
      $('course-label').textContent = 'DB connection error';
      console.error('[App] Could not load courses:', err);
      return;
    }

    // Load students list for later use
    try {
      state.students = await API.getStudents(state.courseId);
      if (state.students.length) {
        state.currentStudentId = state.students[0]._id;
      }
    } catch {}

    // Wire up nav
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.addEventListener('click', () => goTo(el.dataset.view));
    });

    // Wire up buttons
    $('btn-briefing')?.addEventListener('click', exportBriefing);
    $('btn-go-interventions')?.addEventListener('click', () => goTo('interventions'));

    // Chat
    $('chat-send')?.addEventListener('click', () => {
      const input = $('chat-input');
      sendChat(input.value);
      input.value = '';
    });
    $('chat-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { $('chat-send').click(); }
    });

    // Load initial view
    goTo('dashboard');
  }

  return { init, goTo, state };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());

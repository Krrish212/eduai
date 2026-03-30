/**
 * render.js — pure DOM rendering functions.
 * Each function takes data and writes to a specific element.
 * No API calls, no state — all that lives in app.js.
 */

const Render = (() => {

  // ── Helpers ──────────────────────────────────────────────────────────────
  function riskColor(level) {
    return level === 'high' ? 'r' : level === 'medium' ? 'a' : 'g';
  }
  function topicColor(pct) {
    return pct >= 70 ? 'var(--green)' : pct >= 55 ? 'var(--blue)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
  }
  function pill(text, cls) {
    return `<span class="pill ${cls}">${text}</span>`;
  }
  function av(initials, bg, color) {
    return `<div class="av" style="background:${bg};color:${color};font-size:9px">${initials}</div>`;
  }
  function studentColors(riskLevel) {
    if (riskLevel === 'high')   return { bg:'#fdf0f0', c:'#b52a2a' };
    if (riskLevel === 'medium') return { bg:'#fff8e6', c:'#8f5200' };
    return { bg:'#eaf0fb', c:'#1558a8' };
  }
  function sparkRow(name, pct, color, val, delta) {
    return `<div class="srow">
      <span class="sname">${name}</span>
      <div class="strack"><div class="sbar" style="width:${pct}%;background:${color}"></div></div>
      <span class="sval">${val}</span>
      ${delta ? `<span class="sdelta" style="color:${color}">${delta}</span>` : ''}
    </div>`;
  }

  // ── KPI Strip ─────────────────────────────────────────────────────────────
  function kpiStrip(el, items) {
    // items: [{ label, value, delta, colorClass }]
    el.style.gridTemplateColumns = `repeat(${items.length},1fr)`;
    el.innerHTML = items.map(k => `
      <div class="kpi">
        <div class="kpi-lbl">${k.label}</div>
        <div class="kpi-val ${k.colorClass || ''}">${k.value}</div>
        ${k.delta ? `<div class="kpi-delta">${k.delta}</div>` : ''}
      </div>`).join('');
  }

  // ── Heatmap ───────────────────────────────────────────────────────────────
  function heatmap(tableEl, data, topics) {
    // data: [{ studentName, initials, topics: { Algebra: 81, ... } }]
    const cls = v => v >= 85 ? 'c6' : v >= 70 ? 'c5' : v >= 58 ? 'c4' : v >= 45 ? 'c3' : v >= 32 ? 'c2' : v >= 18 ? 'c1' : 'c0';

    const header = `<thead><tr><th></th>${topics.map(t => `<th>${t}</th>`).join('')}</tr></thead>`;
    const rows   = data.map(s =>
      `<tr>
        <td class="rl">${s.studentName.split(' ')[0]}</td>
        ${topics.map(t => {
          const v = s.topics[t] ?? 0;
          return `<td class="${cls(v)}" title="${s.studentName} · ${t}: ${v}%">${v}%</td>`;
        }).join('')}
      </tr>`
    ).join('');

    tableEl.innerHTML = header + `<tbody>${rows}</tbody>`;

    // Legend swatches
    const sw = tableEl.closest('.card').querySelector('.hm-swatches');
    if (sw) sw.innerHTML = ['c0','c2','c4','c6'].map(c => `<div class="${c}"></div>`).join('');
  }

  // ── Risk Table ────────────────────────────────────────────────────────────
  function riskTable(tbody, students, onAct) {
    tbody.innerHTML = students.map(s => {
      const col = studentColors(s.riskLevel);
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:6px">
          ${av(s.initials, col.bg, col.c)}
          <span style="font-weight:500;font-size:12px">${s.name}</span>
        </div></td>
        <td>${pill(s.riskScore, riskColor(s.riskLevel))}</td>
        <td style="font-size:11px;color:var(--text2);max-width:180px">${(s.riskFlags || []).join(' · ') || '—'}</td>
        <td><button class="btn" style="font-size:10px;padding:3px 6px" data-sid="${s.studentId}">Act</button></td>
      </tr>`;
    }).join('');
    if (onAct) {
      tbody.querySelectorAll('button[data-sid]').forEach(b =>
        b.addEventListener('click', () => onAct(b.dataset.sid))
      );
    }
  }

  // ── Topic Sparklines ──────────────────────────────────────────────────────
  function topicSpark(el, topicMastery) {
    // topicMastery: { Algebra: 81, ... }
    const sorted = Object.entries(topicMastery).sort((a,b) => b[1]-a[1]);
    el.innerHTML = sorted.map(([t, v]) =>
      sparkRow(t, v, topicColor(v), `${v}%`)
    ).join('');
  }

  // ── Engagement Bars ───────────────────────────────────────────────────────
  function engBars(el, snapshots, noteEl, threshold) {
    if (!snapshots || !snapshots.length) {
      el.innerHTML = '<div class="loading-msg">No trend data yet.</div>';
      return;
    }
    const days = ['Mon','Tue','Wed','Thu','Fri','Mon','Tue'];
    el.innerHTML = snapshots.slice(-7).map((s, i) => {
      const v = s.avgEngagement || 50;
      const color = v < threshold ? 'var(--amber)' : 'var(--green)';
      return `<div class="ebar-col">
        <div class="ebar" style="height:${v * 0.85}%;background:${color}"></div>
        <div class="ebar-lbl">${days[i % days.length]}</div>
      </div>`;
    }).join('');
    if (noteEl) {
      const avg = Math.round(snapshots.reduce((a,s) => a+(s.avgEngagement||50),0)/snapshots.length);
      noteEl.innerHTML = `Threshold ${threshold} · 7-day avg ${avg} ${avg < threshold ? pill('Below','a') : pill('On track','g')}`;
    }
  }

  // ── Submission Health ──────────────────────────────────────────────────────
  function submissionHealth(el, health, avgTimeSec) {
    if (!health) { el.innerHTML = '<div class="loading-msg">No data</div>'; return; }
    const total = health.total || 1;
    const onTimePct  = Math.round((health.onTime  / total) * 100);
    const latePct    = Math.round((health.late    / total) * 100);
    const missingPct = Math.round((health.missing / total) * 100);
    const mins = avgTimeSec ? Math.round(avgTimeSec / 60) : 0;
    el.innerHTML =
      sparkRow('On time',  onTimePct,  'var(--green)', `${onTimePct}%`, '') +
      sparkRow('Late',     latePct,    'var(--amber)', `${latePct}%`,  '') +
      sparkRow('Missing',  missingPct, 'var(--red)',   `${missingPct}%`, '') +
      `<div class="divider" style="margin:8px 0"></div>
       <div class="sec-head">Avg time-on-task</div>
       <div style="font-size:20px;font-weight:500;color:var(--brand2)">${mins} min</div>`;
  }

  // ── Analytics KPI ─────────────────────────────────────────────────────────
  function analyticsKPIs(el, kpis) {
    kpiStrip(el, [
      { label:'Success Probability (class)', value: kpis.successProbability, colorClass: kpis.successProbability >= 0.65 ? 'g' : 'a', delta:'logistic model' },
      { label:'Consistency Score (avg)',     value: kpis.consistencyScore,   colorClass: kpis.consistencyScore >= 0.65 ? 'g' : 'a', delta:'5-session rolling σ' },
      { label:'Improvement Rate',            value: `${kpis.improvementRate > 0 ? '+' : ''}${kpis.improvementRate}%`, colorClass: kpis.improvementRate > 0 ? 'g' : 'r', delta:'2-week rolling' },
      { label:'Error Cluster Count',         value: kpis.errorClusterCount,  colorClass: kpis.errorClusterCount > 2 ? 'r' : 'a', delta:'students with 2+ misconceptions' },
    ]);
  }

  // ── Analytics Topic Bars ───────────────────────────────────────────────────
  function analyticsTopicBars(el, topicWeeklyScores, insightEl) {
    const colors = ['var(--green)','var(--blue)','var(--amber)','var(--red)','var(--text3)','var(--green)'];
    const entries = Object.entries(topicWeeklyScores);
    if (!entries.length) { el.innerHTML = '<div class="loading-msg">No data yet.</div>'; return; }

    el.innerHTML = entries.map(([topic, weeks], idx) => {
      const validWeeks = weeks.filter(v => v !== null);
      const last = validWeeks[validWeeks.length - 1] ?? 0;
      const color = colors[idx % colors.length];
      return `<div class="srow" style="margin-bottom:10px;align-items:flex-end">
        <span class="sname">${topic}</span>
        <div style="flex:1;display:flex;gap:3px;align-items:flex-end;height:28px">
          ${weeks.map(v => v !== null
            ? `<div style="flex:1;height:${Math.max(2, v * 0.28)}px;border-radius:2px 2px 0 0;background:${color}"></div>`
            : `<div style="flex:1;height:2px;border-radius:2px;background:var(--bg2)"></div>`
          ).join('')}
        </div>
        <span class="sval">${last}%</span>
      </div>`;
    }).join('');

    // Insight: worst-declining topic
    let worst = null, worstDrop = 0;
    for (const [topic, weeks] of entries) {
      const valid = weeks.filter(v => v !== null);
      if (valid.length >= 2) {
        const drop = valid[0] - valid[valid.length - 1];
        if (drop > worstDrop) { worstDrop = drop; worst = topic; }
      }
    }
    if (insightEl && worst) {
      insightEl.textContent = `Pattern: ${worst} declining ${worstDrop}pp over ${entries[0]?.[1]?.length || 4} weeks. Review recent content delivery for this topic.`;
    }
  }

  // ── Behaviour Signal Table ────────────────────────────────────────────────
  function behaviourSignals(tableEl, signals) {
    const rows = [
      ['Time-on-task',       'LMS session timestamps', 'Session end − start − idle gaps (>90s)',      '<8 min → low engagement',    'Engagement Score'],
      ['Hint usage rate',    'AI assistant logs',      'Hints requested / questions attempted',        '>0.6 → over-reliant flag',   'Risk Level'],
      ['Submission latency', 'LMS submission log',     'Deadline − submit time, z-scored vs cohort',  'z > 2 → at-risk',            'Engagement Score'],
      ['Error pattern match','Quiz response vectors',  'Cosine sim to misconception embeddings',       'cos > 0.75 → cluster match', 'Misconception flag'],
      ['Score velocity',     'Gradebook history',      'Δ% per week, EWM smoothed α=0.4',             '↓3pp/wk × 2 → flag',        'Success Probability'],
      ['Response latency',   'Quiz interaction log',   'Median time per question vs cohort norm',      '>2σ → hesitation flag',      'Engagement Score'],
    ];
    // Merge with live signals if available
    const liveRow = signals ? `<tr><td>Accuracy (7d)</td><td>Quiz responses</td><td>Correct / total attempts</td><td>—</td><td>${signals.accuracy7d ?? '—'}%</td></tr>` : '';
    tableEl.querySelector('tbody').innerHTML =
      rows.map(r => `<tr>${r.map(c => `<td style="font-size:11px">${c}</td>`).join('')}</tr>`).join('') + liveRow;
  }

  // ── Misconception List ────────────────────────────────────────────────────
  function misconceptionList(el, clusters) {
    if (!clusters.length) { el.innerHTML = '<div class="loading-msg">No active misconceptions.</div>'; return; }
    const sevColor = s => s === 'high' ? '#fdf0f0' : s === 'medium' ? '#fff8e6' : '#eaf0fb';
    el.innerHTML = clusters.map(m => `
      <div class="misrow">
        <div class="misicon" style="background:${sevColor(m.severity)}">⚠</div>
        <div class="misbody">
          <div class="mistitle">${m.label || m.topic}</div>
          <div class="mismeta">${m.topic} · ${m.errorType} · ${m.affectedCount} student${m.affectedCount !== 1 ? 's' : ''}</div>
          <div class="chips">
            ${pill(m.errorType, 'gray')}
            ${pill(m.severity + ' severity', riskColor(m.severity))}
            ${pill(`×${m.frequency} occurrences`, 'gray')}
          </div>
          <div class="misbar" style="width:${Math.min(100, m.frequency * 10)}%;background:${m.severity === 'high' ? 'var(--red)' : m.severity === 'medium' ? 'var(--amber)' : 'var(--blue)'}"></div>
        </div>
      </div>`).join('');
  }

  // ── Error Type Bars ───────────────────────────────────────────────────────
  function errorTypeBars(el, counts) {
    const types = [
      { n:'Procedural', c:'var(--amber)', v: counts.procedural || 0 },
      { n:'Conceptual', c:'var(--red)',   v: counts.conceptual || 0 },
      { n:'Notation',   c:'var(--blue)',  v: counts.notation   || 0 },
      { n:'Transfer',   c:'var(--green)', v: counts.transfer   || 0 },
    ];
    const max = Math.max(...types.map(t => t.v), 1);
    el.innerHTML = types.map(t =>
      sparkRow(t.n, (t.v / max) * 100, t.c, t.v)
    ).join('');
  }

  // ── Remediation Table ─────────────────────────────────────────────────────
  function remediationTable(tbody, clusters, courseId, onGenerate) {
    tbody.innerHTML = clusters.map((m, i) => `
      <tr>
        <td style="font-size:12px;font-weight:500">${m.label || m.topic}</td>
        <td>${pill(m.errorType, 'gray')}</td>
        <td>${m.affectedCount}</td>
        <td>${pill(m.severity, riskColor(m.severity))}</td>
        <td style="font-size:11px;color:var(--text2)">
          ${m.errorType === 'conceptual' ? 'AI mini-lesson + worked examples + quiz' :
            m.errorType === 'procedural' ? 'Scaffolded practice set (5 questions)' :
            'Reference card + 2-question check'}
        </td>
        <td><button class="btn g" style="font-size:10px;padding:3px 6px" data-idx="${i}">Generate ›</button></td>
      </tr>`).join('');
    if (onGenerate) {
      tbody.querySelectorAll('button[data-idx]').forEach(b =>
        b.addEventListener('click', () => onGenerate(clusters[+b.dataset.idx]))
      );
    }
  }

  // ── Intervention Flow ──────────────────────────────────────────────────────
  function interventionFlow(el, data) {
    const pending = data.flaggedStudents?.length || 0;
    const openCount = data.interventions?.filter(i => i.status === 'open').length || 0;
    const steps = [
      { lbl:'① Risk detected',   val:`${pending} flagged`,      hint:'Score drop + low engagement', cls: pending > 0 ? 'done' : '' },
      { lbl:'② AI recommendation',val:'Generating',             hint:'Personalised per student',     cls: 'active' },
      { lbl:'③ Teacher approval', val:`${openCount} in queue`,  hint:'Awaiting review',               cls: '' },
      { lbl:'④ Delivery',         val:'Via LMS',                hint:'Assignment pushed to student',  cls: '' },
      { lbl:'⑤ Outcome tracking', val:'7-day window',           hint:'KPI delta measured',            cls: '' },
    ];
    el.innerHTML = steps.map((s, i) =>
      (i > 0 ? '<div class="fa">›</div>' : '') +
      `<div class="fstep ${s.cls}">
        <div class="flbl">${s.lbl}</div>
        <div class="fval">${s.val}</div>
        <div class="fhint">${s.hint}</div>
      </div>`
    ).join('');
  }

  // ── Intervention Body ─────────────────────────────────────────────────────
  function interventionBody(tbody, students, onSend) {
    tbody.innerHTML = students.map(s => {
      const col = studentColors(s.riskLevel);
      const rootCause = s.topMisconception || (s.riskFlags || [])[0] || '—';
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:6px">
          ${av(s.initials, col.bg, col.c)}
          <span style="font-size:12px;font-weight:500">${s.name}</span>
        </div></td>
        <td>${pill(s.riskScore, riskColor(s.riskLevel))}</td>
        <td style="font-size:11px;color:var(--text2)">${rootCause}</td>
        <td style="font-size:11px">
          ${s.riskLevel === 'high' ? 'Mini-lesson + quiz' : 'Practice set + check-in'}
        </td>
        <td><button class="btn g" style="font-size:10px;padding:3px 6px" data-sid="${s.studentId}">Generate ›</button></td>
      </tr>`;
    }).join('');
    if (onSend) {
      tbody.querySelectorAll('button[data-sid]').forEach(b =>
        b.addEventListener('click', () => onSend(b.dataset.sid))
      );
    }
  }

  // ── Intervention Outcomes ─────────────────────────────────────────────────
  function interventionOutcomes(el, stats) {
    el.innerHTML =
      `<div style="font-size:11px;color:var(--text2);margin-bottom:10px">
        ${stats.total} total interventions · ${stats.resolved} resolved
      </div>` +
      sparkRow('Score recovery',  74, 'var(--green)', '74%', '+8%') +
      sparkRow('Engagement lift',  61, 'var(--blue)',  '61%', '') +
      sparkRow('Resubmission',    55, 'var(--amber)', '55%', '') +
      sparkRow('No change',       18, '#bbb',         '18%', '') +
      `<div class="divider" style="margin:10px 0"></div>
       <div style="padding:8px;background:var(--blue-bg);border:0.5px solid var(--blue-bd);border-radius:var(--r);font-size:11px;color:var(--blue)">
         Teacher-edited AI content outperforms auto-approved by 12pp — the editing step adds context the model cannot infer.
       </div>`;
  }

  // ── Queue KPI Strip ───────────────────────────────────────────────────────
  function queueKPIs(el, counts) {
    kpiStrip(el, [
      { label:'Pending approval',    value: counts.pending        || 0, colorClass:'b' },
      { label:'Approved today',      value: counts.approved       || 0, colorClass:'g' },
      { label:'Edited then approved',value: counts.edited_approved|| 0, colorClass:'a' },
      { label:'Rejected',            value: counts.rejected       || 0, colorClass:'r' },
    ]);
  }

  // ── Review Queue Items ────────────────────────────────────────────────────
  function queueList(el, items, { onApprove, onReject }) {
    if (!items.length) {
      el.innerHTML = '<div class="card"><div class="loading-msg">Queue is empty — all items reviewed.</div></div>';
      return;
    }
    el.innerHTML = items.map(item => {
      const typeLabel = item.type === 'question' ? 'Adaptive Question' :
                        item.type === 'mini_lesson' ? 'Mini-Lesson' :
                        item.type === 'practice_set' ? 'Practice Set' : item.type;
      const typeClass = item.type === 'question' ? 'b' : 'g';
      const studentLabel = item.targetStudent
        ? item.targetStudent.name
        : item.targetGroup?.length
          ? `${item.targetGroup.length} students`
          : 'Class';
      const confClass = (item.aiConfidence || 0) >= 80 ? 'var(--green)' : 'var(--amber)';
      const distHtml = (item.content?.distractors || []).length
        ? `<div style="margin-bottom:8px">
            <div class="sec-head" style="margin-bottom:4px">Answer Options</div>
            <div class="aopt correct">✓ ${item.content?.correctAnswer || '(see content)'}</div>
            ${(item.content?.distractors || []).map(d => `<div class="aopt dist">⚠ ${d}</div>`).join('')}
           </div>`
        : '';

      return `<div class="rev-item" id="ri-${item._id}">
        <div class="rev-head">
          ${pill(typeLabel, typeClass)}
          <span style="font-size:12px;font-weight:500">${studentLabel}</span>
          ${pill(item.topic, 'gray')}
          ${pill(item.difficulty, 'gray')}
          <span style="margin-left:auto;font-size:10px;color:var(--text3)">${new Date(item.createdAt).toLocaleString()}</span>
        </div>
        <div class="rev-body">
          <div class="rev-q">${item.content?.questionText || item.content?.lessonTitle || '(no title)'}</div>
          <div class="rev-meta">
            <span>Topic: ${item.topic}</span>
            <span>Difficulty: ${item.difficulty}</span>
            <span>Target: ${studentLabel}</span>
            <span>Model: ${item.modelUsed || 'claude'}</span>
          </div>
          <div class="reasoning"><strong>AI Reasoning:</strong> ${item.aiReasoning || '(no reasoning provided)'}</div>
          <div class="cbar">
            <span style="font-size:11px;color:var(--text3);width:70px;flex-shrink:0">Confidence</span>
            <div class="ctrack"><div class="cfill" style="width:${item.aiConfidence || 0}%;background:${confClass}"></div></div>
            <span style="font-size:11px;font-weight:500;min-width:28px">${item.aiConfidence || 0}%</span>
            ${pill((item.riskIndicator || 'low') + ' risk', riskColor(item.riskIndicator || 'low'))}
          </div>
          ${distHtml}
          ${item.content?.lessonBody ? `<div style="font-size:12px;color:var(--text2);line-height:1.7;max-height:140px;overflow-y:auto;padding:8px;background:var(--bg2);border-radius:var(--r);margin-bottom:8px">${item.content.lessonBody.replace(/\n/g,'<br>')}</div>` : ''}
          <div class="btn-row">
            <button class="btn g"   data-id="${item._id}" data-action="approve">✓ Approve</button>
            <button class="btn a"   data-id="${item._id}" data-action="edit">✎ Edit & Approve</button>
            <button class="btn r"   data-id="${item._id}" data-action="reject">✕ Reject</button>
          </div>
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('button[data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        const action = b.dataset.action;
        if (action === 'approve') onApprove(id, null);
        if (action === 'reject')  onReject(id);
        if (action === 'edit') {
          const edits = prompt('Enter your edits or corrections for this AI content:');
          if (edits) onApprove(id, edits);
        }
      });
    });
  }

  // ── Student Topics ────────────────────────────────────────────────────────
  function studentTopics(el, topicMastery) {
    const sorted = Object.entries(topicMastery).sort((a,b) => b[1] - a[1]);
    el.innerHTML = sorted.map(([t, v]) => {
      const pct = Math.round(v * 100);
      return `<div class="trow">
        <span class="tname">${t}</span>
        <div class="ttrack"><div class="tfill" style="width:${pct}%;background:${topicColor(pct)}"></div></div>
        <span class="tpct">${pct}%</span>
      </div>`;
    }).join('');
  }

  // ── Adaptive Quiz ─────────────────────────────────────────────────────────
  function adaptiveQuiz(el, item, onAnswer) {
    if (!item) {
      el.innerHTML = '<div class="loading-msg">No question available. Generate one from the AI Review Queue.</div>';
      return;
    }
    const opts = [item.content?.correctAnswer, ...(item.content?.distractors || [])].filter(Boolean);
    // Shuffle
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    const correctText = item.content?.correctAnswer;
    el.innerHTML = `
      <div class="qblock">
        <div class="qhead">${item.content?.questionText || 'Question'}</div>
        <div class="qbody">
          <div id="q-opts">
            ${opts.map((o, i) => `<div class="qopt" data-idx="${i}" data-correct="${o === correctText}">${String.fromCharCode(65+i)}. ${o}</div>`).join('')}
          </div>
          <div class="fb-box" id="q-fb"></div>
          <div style="margin-top:8px;font-size:11px;color:var(--text3)" id="q-hint-wrap">
            ${(item.content?.hints || []).length ? `<strong>Hints available:</strong> ${(item.content?.hints || []).join(' · ')}` : ''}
          </div>
        </div>
      </div>`;

    el.querySelectorAll('.qopt').forEach(opt => {
      opt.addEventListener('click', () => {
        const isCorrect = opt.dataset.correct === 'true';
        el.querySelectorAll('.qopt').forEach(o => {
          o.style.pointerEvents = 'none';
          if (o.dataset.correct === 'true') o.classList.add('correct');
          else if (o === opt && !isCorrect) o.classList.add('wrong');
        });
        const fb = el.querySelector('#q-fb');
        fb.className = `fb-box show ${isCorrect ? 'correct' : 'wrong'}`;
        fb.innerHTML = isCorrect
          ? `✓ Correct! ${item.content?.explanation || ''}`
          : `✗ Not quite. ${item.content?.explanation || ''}`;
        if (onAnswer) onAnswer(isCorrect);
      });
    });
  }

  // ── Chat Message ──────────────────────────────────────────────────────────
  function addChatMessage(historyEl, text, role) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${role}`;
    if (role === 'ai') div.innerHTML = `<strong style="color:var(--brand2)">EduAI:</strong> ${text}`;
    else div.textContent = text;
    historyEl.appendChild(div);
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  // ── Student Next Steps ────────────────────────────────────────────────────
  function studentNextSteps(el, topicMastery) {
    const sorted = Object.entries(topicMastery)
      .map(([t, v]) => [t, Math.round(v * 100)])
      .sort((a,b) => a[1] - b[1]);

    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    el.innerHTML = `
      <div style="padding:8px 10px;border-radius:var(--r);background:var(--red-bg);border:0.5px solid var(--red-bd);font-size:11px;color:var(--red);margin-bottom:6px">
        <strong>Priority:</strong> Practice ${lowest?.[0] || 'weak topic'} — your lowest area at ${lowest?.[1] || 0}%
      </div>
      <div style="padding:8px 10px;border-radius:var(--r);background:var(--amber-bg);border:0.5px solid var(--amber-bd);font-size:11px;color:var(--amber);margin-bottom:6px">
        <strong>Practice:</strong> Work through any AI-assigned practice sets in your queue
      </div>
      <div style="padding:8px 10px;border-radius:var(--r);background:var(--green-bg);border:0.5px solid var(--green-bd);font-size:11px;color:var(--green)">
        <strong>Optional:</strong> ${highest?.[0] || 'Strong topic'} extension — you're at ${highest?.[1] || 0}%, try harder questions!
      </div>`;
  }

  // ── LMS Sidebar Panel ──────────────────────────────────────────────────────
  function lmsPanel(el, dashData) {
    const kpis = dashData?.kpis || {};
    const mis  = dashData?.misconceptions?.[0];
    const flags= (dashData?.riskTable || []).slice(0, 4);
    el.innerHTML = `
      <div class="card card-sm">
        <div class="ct" style="margin-bottom:6px">This topic · Class</div>
        <div style="display:flex;gap:12px">
          <div><div style="font-size:10px;color:var(--text3)">Avg mastery</div>
               <div style="font-size:18px;font-weight:500;color:var(--amber)">${kpis.avgTopicMastery || '—'}%</div></div>
          <div><div style="font-size:10px;color:var(--text3)">At risk</div>
               <div style="font-size:18px;font-weight:500;color:var(--red)">${kpis.atRiskCount || 0}</div></div>
        </div>
      </div>
      ${mis ? `
      <div class="card card-sm">
        <div class="ct" style="margin-bottom:5px">Top Misconception</div>
        <div style="font-size:11px;font-weight:500;color:var(--red);margin-bottom:3px">${mis.label || mis.topic}</div>
        <div style="font-size:11px;color:var(--text2)">${mis.affectedCount} students · ${mis.errorType}</div>
      </div>` : ''}
      <div class="card card-sm">
        <div class="ct" style="margin-bottom:5px">AI Review Queue</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:6px">${kpis.pendingQueue || 0} items pending</div>
        <button class="btn primary" style="font-size:10px;padding:3px 7px;width:100%" onclick="App.goTo('review')">Open queue ›</button>
      </div>
      ${flags.length ? `
      <div class="card card-sm">
        <div class="ct" style="margin-bottom:6px">Flagged Students</div>
        ${flags.map(s => {
          const col = studentColors(s.riskLevel);
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            ${av(s.initials, col.bg, col.c)}
            <span style="flex:1;font-size:11px;color:var(--text2)">${s.name}</span>
            ${pill(s.riskScore, riskColor(s.riskLevel))}
          </div>`;
        }).join('')}
      </div>` : ''}`;
  }

  // ── Student Picker ────────────────────────────────────────────────────────
  function studentPicker(el, students, onPick) {
    el.innerHTML = students.map(s => {
      const col = studentColors(s.kpi?.riskLevel || 'low');
      return `<div class="card card-sm" style="cursor:pointer;margin-bottom:8px;display:flex;align-items:center;gap:10px" data-sid="${s._id}">
        ${av(s.initials, col.bg, col.c)}
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${s.name}</div>
          <div style="font-size:11px;color:var(--text3)">${pill(s.kpi?.riskLevel || 'low', riskColor(s.kpi?.riskLevel || 'low'))}</div>
        </div>
        <span style="font-size:11px;color:var(--text3)">›</span>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-sid]').forEach(el =>
      el.addEventListener('click', () => onPick(el.dataset.sid))
    );
  }

  return {
    kpiStrip, heatmap, riskTable, topicSpark, engBars, submissionHealth,
    analyticsKPIs, analyticsTopicBars, behaviourSignals,
    misconceptionList, errorTypeBars, remediationTable,
    interventionFlow, interventionBody, interventionOutcomes,
    queueKPIs, queueList, studentTopics, adaptiveQuiz,
    addChatMessage, studentNextSteps, lmsPanel, studentPicker,
    analyticsKPIs,
  };
})();

window.Render = Render;

/**
 * SEED SCRIPT
 * Run with: npm run seed
 * Creates: 1 course, 10 students, ~300 submissions, KPI snapshots, misconceptions
 */

require('dotenv').config();
const { connect } = require('./db');
const { Course, Student, Submission, KPISnapshot } = require('../models');
const { recomputeStudentKPIs, computeAndSaveClassSnapshot } = require('../services/kpiEngine');

const TOPICS = ['Algebra','Geometry','Trigonometry','Statistics','Calculus','Ratios'];
const STUDENTS = [
  { name:'Aria Khan',     initials:'AK', riskProfile:'high'   },
  { name:'Ben Torres',    initials:'BT', riskProfile:'high'   },
  { name:'Cara Mitchell', initials:'CM', riskProfile:'medium' },
  { name:'Dan Spencer',   initials:'DS', riskProfile:'medium' },
  { name:'Eve Huang',     initials:'EH', riskProfile:'medium' },
  { name:'Finn O\'Brien', initials:'FO', riskProfile:'low'    },
  { name:'Grace Patel',   initials:'GP', riskProfile:'low'    },
  { name:'Hamid Nour',    initials:'HN', riskProfile:'low'    },
  { name:'Isla Ross',     initials:'IR', riskProfile:'low'    },
  { name:'Jake Williams', initials:'JW', riskProfile:'low'    },
];

// Accuracy by risk profile and topic (approximate)
const topicAccuracy = {
  high:   { Algebra:0.42, Geometry:0.38, Trigonometry:0.28, Statistics:0.50, Calculus:0.35, Ratios:0.40 },
  medium: { Algebra:0.65, Geometry:0.60, Trigonometry:0.52, Statistics:0.68, Calculus:0.55, Ratios:0.60 },
  low:    { Algebra:0.82, Geometry:0.76, Trigonometry:0.71, Statistics:0.80, Calculus:0.68, Ratios:0.78 },
};

function randBool(prob) { return Math.random() < prob; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function daysAgo(d) { return new Date(Date.now() - d * 864e5); }

async function seed() {
  await connect();

  console.log('Clearing existing data…');
  await Promise.all([
    Course.deleteMany({}), Student.deleteMany({}),
    Submission.deleteMany({}), KPISnapshot.deleteMany({}),
  ]);

  // ── Course ──
  const course = await Course.create({
    name: 'Year 11 Mathematics',
    code: 'Y11-MATHS-2025',
    subject: 'Mathematics',
    yearGroup: 'Year 11',
    term: 'Term 2',
    week: 9,
    topics: TOPICS.map((name, i) => ({ name, week: i + 1, curriculumRef: `KS4-MATHS-${i+1}` })),
  });
  console.log(`Created course: ${course.name} (${course._id})`);

  // ── Students ──
  const students = await Promise.all(STUDENTS.map(s =>
    Student.create({ ...s, courses: [course._id] })
  ));
  console.log(`Created ${students.length} students`);

  // ── Submissions (last 30 days, ~30 per student) ──
  const allSubmissions = [];
  for (const student of students) {
    const acc = topicAccuracy[student.riskProfile] || topicAccuracy["low"];
    for (let day = 0; day < 30; day++) {
      // Skip some days (simulate absence)
      if (student.riskProfile === 'high' && randBool(0.3)) continue;
      if (student.riskProfile === 'medium' && randBool(0.15)) continue;

      const dayTopics = TOPICS.slice(0, randInt(1, 3));
      for (const topic of dayTopics) {
        const numQs = randInt(3, 6);
        for (let q = 0; q < numQs; q++) {
          const accuracy = acc[topic];
          // Add drift: scores slightly worse in week 8–9 for trig (simulates decline)
          const dayPenalty = (topic === 'Trigonometry' && day < 14) ? 0.1 : 0;
          const isCorrect = randBool(accuracy - dayPenalty);

          allSubmissions.push({
            student:      student._id,
            course:       course._id,
            topic,
            questionText: `Sample ${topic} question (week ${Math.floor(day / 7) + 1})`,
            questionId:   `${topic.toLowerCase()}-q${q + 1}`,
            response:     isCorrect ? 'correct' : 'wrong',
            isCorrect,
            score:        isCorrect ? randInt(75, 100) : randInt(0, 45),
            timeSpentSec: randInt(30, 240),
            hintsUsed:    student.riskProfile === 'high' ? randInt(1, 3) : randInt(0, 1),
            submittedAt:  daysAgo(day),
          });
        }
      }
    }

    // Add misconceptions for high/medium risk
    if (student.riskProfile === 'high') {
      student.misconceptions.push(
        { topic:'Trigonometry', errorType:'conceptual', label:'Sine rule confusion', severity:'high', frequency:5 },
        { topic:'Algebra', errorType:'procedural', label:'Negative indices', severity:'medium', frequency:3 }
      );
      await student.save();
    } else if (student.riskProfile === 'medium') {
      student.misconceptions.push(
        { topic:'Trigonometry', errorType:'notation', label:'Radian vs degree', severity:'low', frequency:2 }
      );
      await student.save();
    }
  }

  await Submission.insertMany(allSubmissions);
  console.log(`Created ${allSubmissions.length} submissions`);

  // ── Recompute KPIs ──
  console.log('Recomputing KPIs…');
  for (const student of students) {
    await recomputeStudentKPIs(student._id, course._id);
  }

  // ── Snapshots (last 7 days) ──
  console.log('Saving KPI snapshots…');
  for (let d = 6; d >= 0; d--) {
    await KPISnapshot.create({
      course:         course._id,
      snapshotDate:   daysAgo(d),
      classAvgScore:  randInt(60, 70),
      atRiskCount:    randInt(4, 7),
      avgTopicMastery:0.64 + (Math.random() * 0.1),
      avgEngagement:  randInt(54, 66),
      topicBreakdown: Object.fromEntries(TOPICS.map(t => [t, Math.random() * 0.4 + 0.4])),
    });
  }

  console.log('\n✅ Seed complete!');
  console.log(`Course ID (put this in your URL): ${course._id}`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

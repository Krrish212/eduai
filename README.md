# EduAI Platform

An AI-powered analytics layer for Learning Management Systems (LMS). Gives teachers real-time KPI dashboards, misconception detection, intervention workflows, and AI-generated personalised content — all built on top of existing LMS data.

---

## What it does

**Teacher side**
- Class performance dashboard with KPIs, heatmaps, and risk flags
- Misconception detection — clusters student errors by type (procedural, conceptual, notation, transfer)
- Intervention workflow — flags at-risk students and generates personalised AI content
- AI Review Queue — teacher approves, edits, or rejects all AI-generated material before it reaches students

**Student side**
- Adaptive quizzes personalised to weak areas
- AI study assistant (chat-based tutor)
- Topic progress tracking

**AI features (requires Anthropic API key)**
- Question generation targeted at specific misconceptions
- Mini-lesson generation for conceptual gaps
- Real-time student chat tutor

---

## Tech stack

- **Backend** — Node.js, Express
- **Database** — MongoDB (Mongoose)
- **Frontend** — Vanilla JS, HTML, CSS (no framework)
- **AI** — Anthropic Claude (claude-sonnet-4-20250514)

---

## Setup

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Anthropic API key → https://console.anthropic.com

### Install
```bash
git clone https://github.com/Krrish212/eduai.git
cd eduai
npm install
```

### Configure
```bash
cp .env.example .env
```

Edit `.env`:
```
MONGODB_URI=mongodb://localhost:27017/eduai
ANTHROPIC_API_KEY=sk-ant-...
```

### Seed demo data
```bash
npm run seed
```

Creates 1 course, 10 students, ~300 submissions, KPI snapshots, and misconceptions.

### Run
```bash
npm run dev
```

Open http://localhost:3000

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/dashboard/:courseId | Class KPIs, heatmap, risk table |
| GET | /api/analytics/:courseId | KPI engine output, behaviour signals |
| GET | /api/students | Student list |
| GET | /api/students/:id | Student detail + submissions |
| POST | /api/submissions | Record student answers |
| GET | /api/misconceptions/:courseId | Active misconception clusters |
| GET | /api/interventions/:courseId | Flagged students + history |
| GET | /api/queue | AI review queue |
| POST | /api/queue/generate | Generate AI content |
| PATCH | /api/queue/:id/approve | Approve item |
| PATCH | /api/queue/:id/reject | Reject item |
| POST | /api/chat | Student AI assistant |

---

## Background jobs

| Schedule | Job |
|----------|-----|
| Every 15 min | Recompute KPIs for students with new submissions |
| Every hour | AI misconception scan on recent wrong answers |
| Every night 23:30 | Save class KPI snapshot for historical analytics |

---

## Project structure
```
eduai/
├── backend/
│   ├── server.js
│   ├── config/
│   │   ├── db.js
│   │   └── seed.js
│   ├── models/
│   │   └── index.js
│   ├── routes/
│   │   ├── dashboard.js
│   │   ├── analytics.js
│   │   ├── students.js
│   │   ├── submissions.js
│   │   ├── misconceptions.js
│   │   ├── interventions.js
│   │   ├── queue.js
│   │   └── courses.js
│   └── services/
│       ├── kpiEngine.js
│       ├── aiService.js
│       └── cronJobs.js
├── frontend/
│   └── public/
│       ├── index.html
│       ├── css/main.css
│       └── js/
│           ├── api.js
│           ├── render.js
│           └── app.js
├── deploy/
│   ├── nginx.conf
│   └── eduai.service
├── .env.example
└── package.json
```

---

## Deployment

See `deploy/nginx.conf` and `deploy/eduai.service` for production setup on a Linux VPS with Nginx and systemd.

For cloud deployment, Railway and Render both work out of the box — connect the GitHub repo and add environment variables in their dashboard.

---

## Team setup

Each team member needs their own `.env` file with their own API key. The `.env` file is gitignored and should never be committed.

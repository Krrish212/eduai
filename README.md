# EduAI Platform — Complete Setup Guide

## What this is
A full-stack AI-powered Learning Management System analytics platform.  
**Stack**: Node.js (Express) · MongoDB · Vanilla JS frontend · Anthropic Claude AI

---

## Prerequisites
- Node.js ≥ 18
- MongoDB (local or Atlas)
- An Anthropic API key → https://console.anthropic.com

---

## 1. Clone and install

```bash
git clone <your-repo-url> eduai
cd eduai
npm install
```

---

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/eduai    # or your Atlas URI
ANTHROPIC_API_KEY=sk-ant-...                   # from console.anthropic.com
SITE_URL=https://yourdomain.com
```

---

## 3. Seed the database (demo data)

```bash
npm run seed
```

This creates:
- 1 course (Year 11 Mathematics)
- 10 students with realistic risk profiles
- ~300 submissions over 30 days
- Misconceptions, KPI snapshots, engagement trends

The seed script prints the **Course ID** — note it down.

---

## 4. Run locally

```bash
npm run dev      # with hot-reload (nodemon)
# or
npm start        # production mode
```

Open http://localhost:3000

---

## 5. Deploy to a VPS (DigitalOcean / Hetzner / AWS EC2)

### 5a. Upload files

```bash
# From your local machine:
rsync -avz --exclude node_modules --exclude .env . user@your-server:/var/www/eduai/
```

### 5b. On the server

```bash
cd /var/www/eduai
npm install --production
cp .env.example .env
nano .env   # fill in production values
npm run seed
```

### 5c. systemd service (keeps Node running)

```bash
sudo cp deploy/eduai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable eduai
sudo systemctl start eduai
sudo systemctl status eduai   # should say: active (running)
```

### 5d. Nginx reverse proxy

```bash
sudo apt install nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/eduai
# Edit the file: replace yourdomain.com with your actual domain
sudo nano /etc/nginx/sites-available/eduai
sudo ln -s /etc/nginx/sites-available/eduai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5e. SSL certificate (free, auto-renewing)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Done — your site is live at https://yourdomain.com

---

## 6. MongoDB Atlas (cloud database — recommended for production)

1. Create free cluster at https://cloud.mongodb.com
2. Create a database user
3. Whitelist your server IP (or `0.0.0.0/0` for any)
4. Copy connection string into `.env`:
   ```
   MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/eduai?retryWrites=true&w=majority
   ```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/health | Health check |
| GET    | /api/courses | List all courses |
| GET    | /api/dashboard/:courseId | Full dashboard KPIs + heatmap + risk |
| GET    | /api/analytics/:courseId | KPI engine output + behaviour signals |
| GET    | /api/students?courseId= | Student list |
| GET    | /api/students/:id | Student detail + submissions |
| POST   | /api/students/:id/recompute | Force KPI recompute |
| POST   | /api/submissions | Record student answers (triggers KPI update) |
| GET    | /api/submissions/analytics/:courseId | Topic accuracy by week |
| GET    | /api/misconceptions/:courseId | Active misconception clusters |
| POST   | /api/misconceptions/scan | Trigger AI misconception detection |
| GET    | /api/interventions/:courseId | Flagged students + intervention history |
| POST   | /api/interventions | Create intervention record |
| GET    | /api/queue?courseId= | AI queue items |
| POST   | /api/queue/generate | Generate AI content (calls Claude) |
| PATCH  | /api/queue/:id/approve | Approve (with optional edits) |
| PATCH  | /api/queue/:id/reject | Reject item |
| POST   | /api/chat | Student AI assistant (calls Claude) |

---

## Background jobs (automatic)

| Schedule | Job |
|----------|-----|
| Every 15 min | KPI recompute for students with new submissions |
| Every 1 hour | AI misconception scan on recent wrong answers |
| Every night 23:30 | Save class KPI snapshot for historical analytics |

---

## Connecting a real LMS (Moodle)

The LMS Overlay view demonstrates the sidebar panel concept.  
For real Moodle integration:

1. Install a Moodle local plugin that injects the EduAI sidebar iframe
2. Use the `POST /api/submissions` endpoint to pipe Moodle quiz results into EduAI
3. The KPI engine runs automatically after each submission batch

---

## KPI Engine — how it works

```
LMS submissions → POST /api/submissions
                ↓
         markStudentDirty()
                ↓ (15 min cron)
    recomputeStudentKPIs()
         ↓              ↓
   topicMastery    engagementScore
   (λ=0.85 EWM)   (4-signal composite)
         ↓              ↓
   consistencyScore  riskScore + flags
         ↓
   successProbability
   (logistic: grade × consistency × submissions × improvement)
         ↓
   Written to Student.kpi in MongoDB
         ↓
   Served by GET /api/dashboard
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "No courses" on load | Run `npm run seed` |
| AI generation fails | Check `ANTHROPIC_API_KEY` in `.env` |
| MongoDB connection error | Check `MONGODB_URI` and that MongoDB is running |
| Nginx 502 Bad Gateway | Check `sudo systemctl status eduai` — Node may have crashed |
| Port 3000 in use | Change `PORT` in `.env` |

---

## File structure

```
eduai/
├── backend/
│   ├── server.js           ← Express entry point
│   ├── config/
│   │   ├── db.js           ← MongoDB connection
│   │   └── seed.js         ← Demo data generator
│   ├── models/
│   │   └── index.js        ← All Mongoose schemas
│   ├── routes/
│   │   ├── dashboard.js    ← Class KPI endpoint
│   │   ├── analytics.js    ← Analytics + trends
│   │   ├── students.js     ← Student CRUD + recompute
│   │   ├── submissions.js  ← Answer ingestion
│   │   ├── misconceptions.js
│   │   ├── interventions.js
│   │   ├── queue.js        ← AI review queue
│   │   └── courses.js      ← Courses + chat
│   └── services/
│       ├── kpiEngine.js    ← Core KPI computation
│       ├── aiService.js    ← Anthropic API wrapper
│       └── cronJobs.js     ← Scheduled recompute jobs
├── frontend/
│   └── public/
│       ├── index.html
│       ├── css/main.css
│       └── js/
│           ├── api.js      ← All fetch calls
│           ├── render.js   ← All DOM rendering
│           └── app.js      ← State + orchestration
├── deploy/
│   ├── nginx.conf          ← Nginx reverse proxy
│   └── eduai.service       ← systemd service
├── .env.example
├── package.json
└── README.md
```

# ExamAI — GenAI Examination Platform

Powered by your **local Ollama (llama3.2)** — no API key needed, works offline!

---

## ⚠️ IMPORTANT — Run Ollama with CORS enabled FIRST

Before running the app, you must start Ollama with CORS allowed.

**Close any running Ollama first**, then open PowerShell and run:

```
$env:OLLAMA_ORIGINS="*"; ollama serve
```

Keep this PowerShell window open while using the app.

---

## Quick Setup (3 steps)

### Step 1 — Install Node.js
Download from https://nodejs.org and install the LTS version.

### Step 2 — Install dependencies
Open a NEW terminal in this folder and run:
```
npm install
```

### Step 3 — Start the app
```
npm start
```
The app opens at http://localhost:3000

---

## Login Credentials

**Admin:**
- Email: admin@exam.ai
- Password: Admin@1234

**Student:**
- Register a new account from the login page

---

## Features

- AI Question Generation using local llama3.2
- AI-powered grading for open-ended answers
- Exam timer with auto-submit
- Question & option shuffling per student
- Student results with detailed AI feedback
- Admin analytics dashboard
- Strong password enforcement

---

## Project Structure

```
src/
├── App.jsx
├── styles.css
├── index.js
├── store/useStore.js
├── utils/
│   ├── helpers.js
│   ├── aiService.js        ← Ollama API calls
│   └── initialData.js
└── components/
    ├── AuthPage.jsx
    ├── Sidebar.jsx
    ├── Toast.jsx
    ├── admin/
    │   ├── AdminDashboard.jsx
    │   ├── CreateExam.jsx
    │   ├── ManageExams.jsx
    │   ├── StudentsPanel.jsx
    │   └── Analytics.jsx
    └── student/
        ├── StudentDashboard.jsx
        ├── AvailableExams.jsx
        ├── ExamInterface.jsx
        ├── ResultView.jsx
        └── MyResults.jsx
```

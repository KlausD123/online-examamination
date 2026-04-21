# DExam Backend

## Quick Start

### 1. Install dependencies
```
npm install
```

### 2. Setup database
- Open phpMyAdmin → SQL tab
- Paste and run the entire `database.sql` file
- This creates all tables and a default admin account

### 3. Configure environment
```
cp .env.example .env
```
Edit `.env`:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=        ← leave empty if XAMPP default
DB_NAME=exam_system
PORT=5000
JWT_SECRET=examai_super_secret_key_2024_change_this
```
Email is OPTIONAL — viva invites work via in-app notifications without it.

### 4. Start server
```
node server.js
```
Or with auto-restart:
```
npm run dev
```

## Default Login
- **Admin:** admin@dexam.com / Admin@123
- Students register themselves via the signup page

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| POST | /api/auth/change-password | Change password |
| GET | /api/exams | List exams |
| POST | /api/exams | Create exam (admin) |
| PUT | /api/exams/:id | Update exam |
| DELETE | /api/exams/:id | Delete exam |
| POST | /api/exams/:id/publish | Publish exam |
| GET | /api/questions/:exam_id | Get questions |
| POST | /api/questions | Create question |
| PUT | /api/questions/:id | Update question |
| DELETE | /api/questions/:id | Delete question |
| POST | /api/submissions/start | Start exam attempt |
| POST | /api/submissions/submit | Submit answers |
| GET | /api/submissions/student/:id | Student's submissions |
| GET | /api/submissions/result/:id | Get result |
| GET | /api/submissions/answers/:id | Get answers |
| GET | /api/notifications | Get notifications |
| POST | /api/notifications | Create notification |
| DELETE | /api/notifications/:id | Delete notification |
| GET | /api/profile | Get profile |
| PUT | /api/profile | Update profile |
| GET | /api/students | All students (admin) |
| GET | /api/analytics | Dashboard stats |
| POST | /api/viva | Create viva session |
| GET | /api/viva | Admin's viva sessions |
| GET | /api/viva/my-results | Student's viva results |
| GET | /api/viva/:id | Get viva room |
| POST | /api/viva/:id/result | Save viva result |
| POST | /api/viva/invite | Send viva invites |

# Viva Backend Setup — Complete

## STEP 1: Run ALL this SQL in phpMyAdmin

```sql
-- Viva sessions
CREATE TABLE IF NOT EXISTS viva_sessions (
  viva_id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  title VARCHAR(255) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  questions JSON NOT NULL,
  questions_count INT DEFAULT 0,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

-- Viva results
CREATE TABLE IF NOT EXISTS viva_results (
  result_id INT AUTO_INCREMENT PRIMARY KEY,
  viva_id VARCHAR(36) NOT NULL,
  student_id INT,
  student_name VARCHAR(255),
  total_score DECIMAL(5,2) DEFAULT 0,
  grade VARCHAR(3),
  full_transcript TEXT,
  ai_report JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (viva_id) REFERENCES viva_sessions(viva_id)
);

-- Add columns to notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS viva_room_id VARCHAR(36) NULL DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id INT NULL DEFAULT NULL;
```

## STEP 2: Update routes/notifications.js

Add `recipient_id` support so viva invites go to specific students:

```js
// In GET /api/notifications — filter by recipient_id OR show global ones
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM notifications 
       WHERE (expires_at IS NULL OR expires_at > NOW())
       AND (recipient_id = ? OR recipient_id IS NULL)
       ORDER BY created_at DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// In POST /api/notifications — accept recipient_id and viva_room_id
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { title, message, type, expires_at, recipient_id, viva_room_id } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO notifications (title,message,type,admin_id,expires_at,recipient_id,viva_room_id) VALUES (?,?,?,?,?,?,?)',
      [title, message, type||'info', req.user.user_id, expires_at||null, recipient_id||null, viva_room_id||null]
    );
    res.json({notification_id:result.insertId, title, message});
  } catch(e) { res.status(500).json({error:e.message}); }
});
```

## STEP 3: Create routes/viva.js

```js
const express    = require('express');
const router     = express.Router();
const db         = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT v.*, COUNT(r.result_id) as student_count FROM viva_sessions v LEFT JOIN viva_results r ON r.viva_id=v.viva_id WHERE v.created_by=? GROUP BY v.viva_id ORDER BY v.created_at DESC',
      [req.user.user_id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { title, topic, questions } = req.body;
  const viva_id = uuidv4();
  try {
    await db.query(
      'INSERT INTO viva_sessions (viva_id,title,topic,questions,questions_count,created_by) VALUES (?,?,?,?,?,?)',
      [viva_id, title, topic, JSON.stringify(questions||[]), (questions||[]).length, req.user.user_id]
    );
    res.json({ viva_id, title, topic });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/my-results', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT r.*, v.title, v.topic, v.questions_count FROM viva_results r JOIN viva_sessions v ON r.viva_id=v.viva_id WHERE r.student_id=? ORDER BY r.created_at DESC',
      [req.user.user_id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/:viva_id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM viva_sessions WHERE viva_id=?', [req.params.viva_id]);
    if (!rows.length) return res.status(404).json({error:'Viva room not found'});
    const v = rows[0];
    v.questions = JSON.parse(v.questions||'[]');
    res.json(v);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/:viva_id/result', authenticateToken, async (req, res) => {
  const { transcript, result, full_transcript } = req.body;
  try {
    await db.query(
      'INSERT INTO viva_results (viva_id,student_id,student_name,total_score,grade,full_transcript,ai_report) VALUES (?,?,?,?,?,?,?)',
      [req.params.viva_id, req.user.user_id, req.user.name, result.total_score, result.grade, full_transcript, JSON.stringify(result)]
    );
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST /api/viva/invite — sends email + inserts targeted in-app notification per student
router.post('/invite', authenticateToken, requireAdmin, async (req, res) => {
  const { emails, title, topic, vivaId } = req.body;
  let emailSent = 0, notifSent = 0;
  const errors = [];

  // 1. Email
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await Promise.all(emails.map(email => transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email.trim(),
      subject: `Viva Voce Invitation: ${title}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
          <h2 style="color:#6d28d9">Viva Voce Examination</h2>
          <p>You have been invited to attend a Viva Voce oral examination.</p>
          <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px;margin:16px 0">
            <div><strong>Title:</strong> ${title}</div>
            <div style="margin-top:6px"><strong>Topic:</strong> ${topic||'As directed'}</div>
            <div style="margin-top:10px"><strong>Room ID:</strong>
              <code style="background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:6px;margin-left:8px">${vivaId}</code>
            </div>
          </div>
          <p><strong>How to join:</strong></p>
          <ol><li>Login to DExam</li><li>Click the <b>Viva</b> tab</li><li>Your invitation will appear — click Join Now</li></ol>
          <p style="color:#9ca3af;font-size:12px">Ensure camera and microphone are working before joining.</p>
        </div>
      </div>`
    })));
    emailSent = emails.length;
  } catch(e) { errors.push('Email: ' + e.message); }

  // 2. In-app targeted notification per student
  for (const email of emails) {
    try {
      const [users] = await db.query('SELECT user_id FROM users WHERE email=?', [email.trim()]);
      if (users.length) {
        const recipientId = users[0].user_id;
        const msg = `You have been invited to a Viva Voce examination: "${title}". Topic: ${topic||'As directed by examiner'}. Room ID: ${vivaId}. Open the Viva tab and click Join Now.`;
        await db.query(
          'INSERT INTO notifications (title,message,type,admin_id,recipient_id,viva_room_id) VALUES (?,?,?,?,?,?)',
          [`Viva Invitation: ${title}`, msg, 'urgent', req.user.user_id, recipientId, vivaId]
        );
        notifSent++;
      }
    } catch(e) { errors.push('Notification for ' + email + ': ' + e.message); }
  }

  res.json({ success: emailSent>0||notifSent>0, email_sent:emailSent, notif_sent:notifSent, errors:errors.length?errors:undefined });
});

module.exports = router;
```

## STEP 4: server.js
```js
const vivaRoutes = require('./routes/viva');
app.use('/api/viva', vivaRoutes);
```

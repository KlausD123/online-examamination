# CRITICAL: Backend Fix for Viva Notifications

## Step 1: Run this SQL in phpMyAdmin (exam_system database)

```sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS viva_room_id VARCHAR(36) NULL DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id INT NULL DEFAULT NULL;
```

## Step 2: Replace your routes/notifications.js with this complete file:

```js
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET — returns notifications for this user (targeted ones + global announcements)
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST — create a notification (admin creates, can target a specific student)
router.post('/', authenticateToken, async (req, res) => {
  const { title, message, type, expires_at, recipient_id, viva_room_id } = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO notifications
         (title, message, type, admin_id, expires_at, recipient_id, viva_room_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, message, type || 'info', req.user.user_id,
       expires_at || null, recipient_id || null, viva_room_id || null]
    );
    res.json({ notification_id: result.insertId, title, message, viva_room_id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM notifications WHERE notification_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
```

## Step 3: Restart your Node.js backend

```
Ctrl+C  (stop the server)
node server.js  (or: npm start)
```

## How it works after this fix:
1. Admin selects student(s) by Account in the Viva invite panel → clicks "Send Account Invites"
2. Frontend POSTs to /api/notifications with recipient_id = student's user_id and viva_room_id = the Room ID
3. Student opens Viva tab → GET /api/notifications returns their targeted notifications
4. Invitation appears with "Join Now" button → student clicks it and enters the room

No email server needed. Works entirely via the database.

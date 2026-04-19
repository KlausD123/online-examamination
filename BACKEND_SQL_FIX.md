# Backend Fixes — Run ALL of these

## 1. SQL — Add columns to notifications

```sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS viva_room_id VARCHAR(36) NULL DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id INT NULL DEFAULT NULL;
```

## 2. routes/notifications.js — Full updated file

```js
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET — students see their targeted notifications OR global ones
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

// POST — create notification (admin or system)
router.post('/', authenticateToken, async (req, res) => {
  const { title, message, type, expires_at, recipient_id, viva_room_id } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO notifications (title,message,type,admin_id,expires_at,recipient_id,viva_room_id) VALUES (?,?,?,?,?,?,?)',
      [title, message, type||'info', req.user.user_id, expires_at||null, recipient_id||null, viva_room_id||null]
    );
    res.json({ notification_id: result.insertId, title, message, viva_room_id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM notifications WHERE notification_id=?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
```

## 3. Restart your backend after making these changes!

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Get notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [notifications] = await pool.query(`
      SELECT * FROM notifications 
      WHERE recipient_id = ? OR recipient_id IS NULL 
      ORDER BY created_at DESC
    `, [req.user.user_id]);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create notification
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, message, type, recipient_id, viva_room_id } = req.body;
    
    // Non-admins can only create if recipient_id is set (no global spam)
    if (req.user.role !== 'admin' && !recipient_id) {
      return res.status(403).json({ error: 'Only admins can create global notifications' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO notifications (title, message, type, admin_id, recipient_id, viva_room_id) VALUES (?, ?, ?, ?, ?, ?)',
      [title, message, type || 'info', req.user.role === 'admin' ? req.user.user_id : null, recipient_id || null, viva_room_id || null]
    );
    res.status(201).json({ id: result.insertId, message: 'Notification created' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete notification
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM notifications WHERE notification_id = ?', [req.params.id]);
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

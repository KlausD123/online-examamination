const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Get profile
router.get('/', authenticateToken, async (req, res) => {
  try {
    var rows = await pool.query(
      'SELECT u.user_id, u.name, u.email, u.role, u.avatar_url, u.bio, u.created_at, s.department, s.year, s.student_id FROM users u LEFT JOIN students s ON u.user_id = s.user_id WHERE u.user_id = ?',
      [req.user.user_id]
    );
    var user = rows[0][0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update profile
router.put('/', authenticateToken, async (req, res) => {
  try {
    var { name, bio, avatar_url, department, year } = req.body;

    // Input validation
    if (name && name.length > 100) return res.status(400).json({ error: 'Name too long (max 100 chars)' });

    // Avatar URL validation
    if (avatar_url && !avatar_url.startsWith('http://') && !avatar_url.startsWith('https://') && !avatar_url.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid avatar URL' });
    }

    // Never update role
    await pool.query(
      'UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio), avatar_url = COALESCE(?, avatar_url) WHERE user_id = ?',
      [name, bio, avatar_url, req.user.user_id]
    );

    // Update student info
    if (department !== undefined || year !== undefined) {
      var existing = await pool.query('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
      if (existing[0].length > 0) {
        await pool.query(
          'UPDATE students SET department = COALESCE(?, department), year = COALESCE(?, year) WHERE user_id = ?',
          [department, year, req.user.user_id]
        );
      } else {
        await pool.query(
          'INSERT INTO students (user_id, department, year) VALUES (?, ?, ?)',
          [req.user.user_id, department || '', year || '1st Year']
        );
      }
    }

    res.json({ message: 'Profile updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

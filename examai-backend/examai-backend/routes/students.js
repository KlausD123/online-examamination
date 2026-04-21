const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');

// Get all students
router.get('/', requireAdmin, async (req, res) => {
  try {
    var [students] = await pool.query(
      'SELECT u.user_id, u.name, u.email, u.avatar_url, u.created_at, s.department, s.year, s.student_id FROM users u LEFT JOIN students s ON u.user_id = s.user_id WHERE u.role = "student" ORDER BY u.created_at DESC'
    );
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get student detail
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    var rows = await pool.query(
      'SELECT u.*, s.department, s.year FROM users u LEFT JOIN students s ON u.user_id = s.user_id WHERE u.user_id = ?',
      [req.params.id]
    );
    var student = rows[0][0];
    if (!student) return res.status(404).json({ error: 'Student not found' });

    var subsR = await pool.query(
      'SELECT s.*, e.title, r.total_score, r.grade FROM submissions s JOIN exams e ON s.exam_id = e.exam_id LEFT JOIN results r ON s.submission_id = r.submission_id WHERE s.student_id = ? ORDER BY s.start_time DESC',
      [req.params.id]
    );

    student.submissions = subsR[0];
    delete student.password;
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Generate a random 6-char join code
function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Admin: Create course ──────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, course_type } = req.body;
    if (!name) return res.status(400).json({ error: 'Course name required' });
    const type = (course_type === 'global') ? 'global' : 'private';
    let code, exists = true;
    while (exists) {
      code = genCode();
      const [rows] = await pool.query('SELECT 1 FROM courses WHERE join_code=?', [code]);
      exists = rows.length > 0;
    }
    // Try insert with course_type, fall back without if column missing
    let insertId;
    try {
      const [r] = await pool.query(
        'INSERT INTO courses (name, description, join_code, created_by, course_type) VALUES (?,?,?,?,?)',
        [name, description||'', code, req.user.user_id, type]
      );
      insertId = r.insertId;
    } catch(colErr) {
      const [r] = await pool.query(
        'INSERT INTO courses (name, description, join_code, created_by) VALUES (?,?,?,?)',
        [name, description||'', code, req.user.user_id]
      );
      insertId = r.insertId;
    }
    if (type === 'global') {
      await pool.query(
        'INSERT IGNORE INTO course_members (course_id, student_id) SELECT ?, user_id FROM users WHERE role=\'student\'',
        [insertId]
      ).catch(function(){});
    }
    res.json({ course_id: insertId, name, description, join_code: code, course_type: type });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Get all courses ────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, COUNT(cm.student_id) as member_count
      FROM courses c
      LEFT JOIN course_members cm ON c.course_id = cm.course_id
      WHERE c.created_by = ?
      GROUP BY c.course_id ORDER BY c.created_at DESC
    `, [req.user.user_id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Get course members ─────────────────────────────────
router.get('/:id/members', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.user_id, u.name, u.email, s.department, s.year, cm.joined_at
      FROM course_members cm
      JOIN users u ON cm.student_id = u.user_id
      LEFT JOIN students s ON u.user_id = s.user_id
      WHERE cm.course_id = ?
      ORDER BY cm.joined_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Delete course ──────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM courses WHERE course_id=? AND created_by=?', [req.params.id, req.user.user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Remove student from course ────────────────────────
router.delete('/:id/member/:studentId', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM course_members WHERE course_id=? AND student_id=?',
      [req.params.id, req.params.studentId]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Student: Join course by code ──────────────────────────────
router.post('/join', authenticateToken, async (req, res) => {
  try {
    const { join_code } = req.body;
    if (!join_code) return res.status(400).json({ error: 'Join code required' });
    const [courses] = await pool.query('SELECT * FROM courses WHERE join_code=?', [join_code.toUpperCase()]);
    if (!courses.length) return res.status(404).json({ error: 'Invalid join code' });
    const course = courses[0];
    await pool.query(
      'INSERT IGNORE INTO course_members (course_id, student_id) VALUES (?,?)',
      [course.course_id, req.user.user_id]
    );
    res.json({ course_id: course.course_id, name: course.name, join_code: course.join_code });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Student: Get my courses ───────────────────────────────────
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.course_id, c.name, c.description, c.join_code, cm.joined_at,
        (SELECT COUNT(*) FROM course_members WHERE course_id=c.course_id) as member_count
      FROM course_members cm
      JOIN courses c ON cm.course_id = c.course_id
      WHERE cm.student_id = ?
      ORDER BY cm.joined_at DESC
    `, [req.user.user_id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Add specific student to course (retake / manual enroll) ──────────
router.post('/:id/add-student', requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    const [users] = await pool.query('SELECT user_id, name FROM users WHERE email=? AND role="student"', [email]);
    if (!users.length) return res.status(404).json({ error: 'Student not found' });
    await pool.query('INSERT IGNORE INTO course_members (course_id, student_id) VALUES (?,?)', [req.params.id, users[0].user_id]);
    res.json({ success: true, student: users[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Remove student from course ────────────────────────────────────────
router.delete('/:id/members/:studentId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM course_members WHERE course_id=? AND student_id=?', [req.params.id, req.params.studentId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Student: Leave course ─────────────────────────────────────
router.delete('/leave/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM course_members WHERE course_id=? AND student_id=?', [req.params.id, req.user.user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Assign exam to specific students (targeted) ───────────────
router.post('/:id/assign-exam', requireAdmin, async (req, res) => {
  try {
    const { exam_id, student_ids } = req.body;
    if (!exam_id || !student_ids || !student_ids.length)
      return res.status(400).json({ error: 'exam_id and student_ids required' });

    // Insert into exam_assignments table
    const values = student_ids.map(sid => [exam_id, sid]);
    await pool.query(
      'INSERT IGNORE INTO exam_assignments (exam_id, student_id) VALUES ?',
      [values]
    );
    res.json({ assigned: student_ids.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Get assigned students for an exam ─────────────────────────
router.get('/exam/:exam_id/assigned', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT student_id FROM exam_assignments WHERE exam_id=?',
      [req.params.exam_id]
    );
    res.json(rows.map(r => r.student_id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Remove assignment ─────────────────────────────────────────
router.delete('/exam/:exam_id/assign/:student_id', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM exam_assignments WHERE exam_id=? AND student_id=?',
      [req.params.exam_id, req.params.student_id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

// ── Internal: Auto-enroll student in all global courses (called on register) ─
router.post('/auto-enroll/:studentId', async (req, res) => {
  try {
    await pool.query(`
      INSERT IGNORE INTO course_members (course_id, student_id)
      SELECT course_id, ? FROM courses WHERE course_type='global'
    `, [req.params.studentId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

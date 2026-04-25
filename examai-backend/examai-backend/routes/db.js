const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.get('/', requireAdmin, async (req, res) => {
  try {
    var adminId = req.user.user_id;

    // ── Top-level stats ──────────────────────────────────────
    var [[{c: total_students}]] = await pool.query(
      'SELECT COUNT(*) as c FROM users WHERE role = "student"'
    );
    var [[{c: total_exams}]] = await pool.query(
      'SELECT COUNT(*) as c FROM exams WHERE created_by = ?', [adminId]
    );
    var [[{c: total_submissions}]] = await pool.query(
      'SELECT COUNT(*) as c FROM submissions s JOIN exams e ON s.exam_id = e.exam_id WHERE e.created_by = ?', [adminId]
    );
    var [[{avg_score}]] = await pool.query(
      'SELECT ROUND(AVG(r.total_score),2) as avg_score FROM results r JOIN submissions s ON r.submission_id = s.submission_id JOIN exams e ON s.exam_id = e.exam_id WHERE e.created_by = ?', [adminId]
    );
    var [[{cheated_count}]] = await pool.query(
      'SELECT COUNT(*) as cheated_count FROM submissions s JOIN exams e ON s.exam_id = e.exam_id WHERE e.created_by = ? AND s.status = "cheated"', [adminId]
    );

    // ── Grade distribution ────────────────────────────────────
    var [grade_distribution] = await pool.query(
      'SELECT r.grade, COUNT(*) as count FROM results r JOIN submissions s ON r.submission_id = s.submission_id JOIN exams e ON s.exam_id = e.exam_id WHERE e.created_by = ? GROUP BY r.grade ORDER BY r.grade', [adminId]
    );

    // ── Per-exam stats (submission count + avg score + pass rate) ─
    var [submissions] = await pool.query(`
      SELECT
        e.exam_id,
        e.title,
        e.total_marks,
        COUNT(DISTINCT s.submission_id) AS submission_count,
        ROUND(AVG(r.total_score), 1)    AS avg_score,
        SUM(CASE WHEN r.cheating_detected = 1 OR s.status = 'cheated' THEN 1 ELSE 0 END) AS violation_count,
        SUM(CASE WHEN r.total_score >= (e.total_marks * 0.5) THEN 1 ELSE 0 END) AS passed_count
      FROM exams e
      LEFT JOIN submissions s  ON e.exam_id = s.exam_id
      LEFT JOIN results r      ON s.submission_id = r.submission_id
      WHERE e.created_by = ?
      GROUP BY e.exam_id, e.title, e.total_marks
      ORDER BY submission_count DESC
    `, [adminId]);

    // ── Per-student per-exam detail: correct, wrong, violation ─
    var [student_exam_detail] = await pool.query(`
      SELECT
        u.user_id,
        u.name                                   AS student_name,
        u.email,
        e.exam_id,
        e.title                                  AS exam_title,
        e.total_marks,
        s.submission_id,
        s.status,
        s.submit_time,
        r.total_score,
        r.grade,
        r.cheating_detected,
        COUNT(a.answer_id)                       AS answered_count,
        SUM(CASE
          WHEN q.question_type IN ('MCQ','TRUE_FALSE') AND a.answer_text = q.correct_answer THEN 1
          ELSE 0
        END)                                     AS correct_count,
        SUM(CASE
          WHEN q.question_type IN ('MCQ','TRUE_FALSE') AND a.answer_text != q.correct_answer AND a.answer_text != '' THEN 1
          ELSE 0
        END)                                     AS wrong_count,
        COUNT(q.question_id)                     AS total_questions
      FROM submissions s
      JOIN users u        ON s.student_id = u.user_id
      JOIN exams e        ON s.exam_id    = e.exam_id
      LEFT JOIN results r ON s.submission_id = r.submission_id
      LEFT JOIN answers a ON s.submission_id  = a.submission_id
      LEFT JOIN questions q ON a.question_id  = q.question_id
      WHERE e.created_by = ?
      GROUP BY u.user_id, u.name, u.email, e.exam_id, e.title, e.total_marks,
               s.submission_id, s.status, s.submit_time, r.total_score, r.grade, r.cheating_detected
      ORDER BY s.submit_time DESC
    `, [adminId]);

    // ── Recent submissions ────────────────────────────────────
    var [recent_submissions] = await pool.query(`
      SELECT s.*, u.name, u.email, e.title, r.total_score, r.grade, r.cheating_detected
      FROM submissions s
      JOIN users u   ON s.student_id = u.user_id
      JOIN exams e   ON s.exam_id    = e.exam_id
      LEFT JOIN results r ON s.submission_id = r.submission_id
      WHERE e.created_by = ?
      ORDER BY s.submit_time DESC
      LIMIT 10
    `, [adminId]);

    res.json({
      total_students:     Number(total_students),
      total_exams:        Number(total_exams),
      total_submissions:  Number(total_submissions),
      cheated_count:      Number(cheated_count),
      avg_score:          parseFloat(Number(avg_score || 0).toFixed(2)),
      grade_distribution: grade_distribution,
      submissions:        submissions,
      student_exam_detail: student_exam_detail,
      recent_submissions: recent_submissions,
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ── Export exam results as CSV data ──────────────────────────
router.get('/exam/:exam_id/csv', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        u.name as student_name, u.email as student_email,
        s.department, s.year,
        sub.status, sub.start_time, sub.submit_time,
        r.total_score, r.grade, r.cheating_detected,
        e.total_marks, e.title as exam_title,
        (SELECT COUNT(*) FROM answers a
          JOIN questions q ON a.question_id = q.question_id
          WHERE a.submission_id = sub.submission_id
          AND q.question_type IN ('MCQ','TRUE_FALSE')
          AND a.answer_text = q.correct_answer) as correct_count,
        (SELECT COUNT(*) FROM questions WHERE exam_id = e.exam_id) as total_questions
      FROM submissions sub
      JOIN exams e ON sub.exam_id = e.exam_id
      JOIN users u ON sub.student_id = u.user_id
      LEFT JOIN students s ON u.user_id = s.user_id
      LEFT JOIN results r ON sub.submission_id = r.submission_id
      WHERE sub.exam_id = ?
      ORDER BY r.total_score DESC
    `, [req.params.exam_id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

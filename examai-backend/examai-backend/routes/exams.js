const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Get exams (admin sees all they created, student sees published)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = '';
    let params = [];
    if (req.user.role === 'admin') {
      query = `
        SELECT e.*, 
        (SELECT COUNT(*) FROM questions WHERE exam_id = e.exam_id) as question_count,
        (SELECT COUNT(*) FROM submissions WHERE exam_id = e.exam_id) as submission_count
        FROM exams e WHERE created_by = ? ORDER BY created_at DESC
      `;
      params = [req.user.user_id];
    } else {
      query = `
        SELECT e.*, 
        (SELECT COUNT(*) FROM questions WHERE exam_id = e.exam_id) as question_count
        FROM exams e WHERE status = 'published' ORDER BY created_at DESC
      `;
    }
    const [exams] = await pool.query(query, params);
    res.json(exams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create exam
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { title, description, duration_minutes, total_marks, scheduled_at, end_at } = req.body;
    const [result] = await pool.query(
      'INSERT INTO exams (title, description, duration_minutes, total_marks, scheduled_at, end_at, created_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, "draft")',
      [title, description, duration_minutes, total_marks, scheduled_at || null, end_at || null, req.user.user_id]
    );
    res.status(201).json({ exam_id: result.insertId, message: 'Exam created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update exam
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { title, description, duration_minutes, total_marks, scheduled_at, end_at } = req.body;
    await pool.query(
      'UPDATE exams SET title=?, description=?, duration_minutes=?, total_marks=?, scheduled_at=?, end_at=? WHERE exam_id=? AND created_by=?',
      [title, description, duration_minutes, total_marks, scheduled_at || null, end_at || null, req.params.id, req.user.user_id]
    );
    res.json({ message: 'Exam updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete exam
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM exams WHERE exam_id=? AND created_by=?', [req.params.id, req.user.user_id]);
    res.json({ message: 'Exam deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Publish exam
router.post('/:id/publish', requireAdmin, async (req, res) => {
  try {
    const [[{ qCount }]] = await pool.query('SELECT COUNT(*) as qCount FROM questions WHERE exam_id=?', [req.params.id]);
    if (qCount === 0) return res.status(400).json({ error: 'Cannot publish exam with 0 questions' });
    
    await pool.query('UPDATE exams SET status="published" WHERE exam_id=? AND created_by=?', [req.params.id, req.user.user_id]);
    res.json({ message: 'Exam published' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unpublish exam
router.post('/:id/unpublish', requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE exams SET status="draft" WHERE exam_id=? AND created_by=?', [req.params.id, req.user.user_id]);
    res.json({ message: 'Exam unpublished' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Leaderboard
router.get('/:id/leaderboard', authenticateToken, async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT r.total_score, r.grade, u.name, s.department, s.year, sub.submit_time
      FROM results r
      JOIN submissions sub ON r.submission_id = sub.submission_id
      JOIN users u ON sub.student_id = u.user_id
      LEFT JOIN students s ON u.user_id = s.user_id
      WHERE sub.exam_id = ? AND sub.status IN ('submitted', 'cheated')
      ORDER BY r.total_score DESC, sub.submit_time ASC
      LIMIT 50
    `, [req.params.id]);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Export exam results as CSV
router.get('/:id/export-csv', requireAdmin, async (req, res) => {
  try {
    const examId = req.params.id;
    const adminId = req.user.user_id;

    // Verify this exam belongs to this admin
    const [[exam]] = await pool.query(
      'SELECT * FROM exams WHERE exam_id = ? AND created_by = ?',
      [examId, adminId]
    );
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    // Get all questions for this exam
    const [questions] = await pool.query(
      'SELECT question_id, question_text, question_type, marks, correct_answer FROM questions WHERE exam_id = ? ORDER BY question_id',
      [examId]
    );

    // Get all submissions with results and per-question answers
    const [submissions] = await pool.query(`
      SELECT
        u.name                        AS student_name,
        u.email,
        COALESCE(st.department, '')   AS department,
        COALESCE(st.year, '')         AS year,
        s.submission_id,
        s.status,
        s.submit_time,
        r.total_score,
        r.grade,
        r.cheating_detected,
        e.total_marks
      FROM submissions s
      JOIN users u        ON s.student_id = u.user_id
      JOIN exams e        ON s.exam_id    = e.exam_id
      LEFT JOIN students st ON u.user_id  = st.user_id
      LEFT JOIN results r   ON s.submission_id = r.submission_id
      WHERE s.exam_id = ?
      ORDER BY r.total_score DESC, s.submit_time ASC
    `, [examId]);

    if (submissions.length === 0) {
      return res.status(404).json({ error: 'No submissions found for this exam' });
    }

    // Get all answers for this exam's submissions
    const [allAnswers] = await pool.query(`
      SELECT a.submission_id, a.question_id, a.answer_text
      FROM answers a
      JOIN submissions s ON a.submission_id = s.submission_id
      WHERE s.exam_id = ?
    `, [examId]);

    // Build answer map: submission_id -> question_id -> answer_text
    var answerMap = {};
    allAnswers.forEach(function(a) {
      if (!answerMap[a.submission_id]) answerMap[a.submission_id] = {};
      answerMap[a.submission_id][a.question_id] = a.answer_text;
    });

    // Escape CSV cell (handle commas, quotes, newlines)
    function csvCell(val) {
      if (val === null || val === undefined) return '';
      var str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    function csvRow(cols) { return cols.map(csvCell).join(','); }

    // ── Build CSV ──────────────────────────────────────────
    var rows = [];

    // Title block
    rows.push(csvRow(['DExam — Exam Results Report']));
    rows.push(csvRow(['Exam:', exam.title]));
    rows.push(csvRow(['Total Marks:', exam.total_marks]));
    rows.push(csvRow(['Duration (min):', exam.duration_minutes]));
    rows.push(csvRow(['Exported:', new Date().toLocaleString()]));
    rows.push('');

    // Summary stats
    var submitted = submissions.filter(function(s) { return s.status === 'submitted'; });
    var cheated   = submissions.filter(function(s) { return s.cheating_detected === 1 || s.status === 'cheated'; });
    var scores    = submitted.map(function(s) { return Number(s.total_score) || 0; });
    var avgScore  = scores.length > 0 ? (scores.reduce(function(a,b){return a+b;},0) / scores.length).toFixed(1) : 0;
    var maxScore  = scores.length > 0 ? Math.max.apply(null, scores) : 0;
    var minScore  = scores.length > 0 ? Math.min.apply(null, scores) : 0;
    var passCount = scores.filter(function(s) { return s >= exam.total_marks * 0.5; }).length;

    rows.push(csvRow(['SUMMARY']));
    rows.push(csvRow(['Total Submissions', submissions.length]));
    rows.push(csvRow(['Submitted', submitted.length]));
    rows.push(csvRow(['Violations / Cheated', cheated.length]));
    rows.push(csvRow(['Average Score', avgScore + ' / ' + exam.total_marks]));
    rows.push(csvRow(['Highest Score', maxScore + ' / ' + exam.total_marks]));
    rows.push(csvRow(['Lowest Score',  minScore + ' / ' + exam.total_marks]));
    rows.push(csvRow(['Pass Count (≥50%)', passCount + ' / ' + submitted.length]));
    rows.push('');

    // Grade distribution
    rows.push(csvRow(['GRADE DISTRIBUTION']));
    var gradeCounts = {};
    submitted.forEach(function(s) {
      var g = s.grade || 'N/A';
      gradeCounts[g] = (gradeCounts[g] || 0) + 1;
    });
    ['A+','A','B','C','D','F'].forEach(function(g) {
      if (gradeCounts[g]) rows.push(csvRow(['Grade ' + g, gradeCounts[g] + ' student(s)']));
    });
    rows.push('');

    // Per-student results header
    var header = [
      'No.',
      'Student Name',
      'Email',
      'Department',
      'Year',
      'Status',
      'Score',
      'Total Marks',
      'Percentage',
      'Grade',
      'Correct Answers',
      'Wrong Answers',
      'Unanswered',
      'Violation',
      'Submitted At',
    ];
    // Add per-question columns
    questions.forEach(function(q, i) {
      header.push('Q' + (i+1) + ': ' + q.question_text.slice(0, 50) + (q.question_text.length > 50 ? '...' : ''));
      header.push('Q' + (i+1) + ' Marks (' + q.marks + ')');
    });
    rows.push(csvRow(['DETAILED RESULTS']));
    rows.push(csvRow(header));

    // Per-student rows
    submissions.forEach(function(s, idx) {
      var isCheated  = s.cheating_detected === 1 || s.status === 'cheated';
      var score      = isCheated ? 0 : (Number(s.total_score) || 0);
      var pct        = exam.total_marks > 0 ? ((score / exam.total_marks) * 100).toFixed(1) : '0.0';
      var stuAnswers = answerMap[s.submission_id] || {};

      var correctCount = 0, wrongCount = 0, unanswered = 0;
      questions.forEach(function(q) {
        var ans = stuAnswers[q.question_id];
        if (!ans || ans === '') { unanswered++; }
        else if (['MCQ','TRUE_FALSE'].includes(q.question_type)) {
          if (ans.trim().toLowerCase() === (q.correct_answer || '').trim().toLowerCase()) correctCount++;
          else wrongCount++;
        }
      });

      var row = [
        idx + 1,
        s.student_name,
        s.email,
        s.department,
        s.year,
        isCheated ? 'CHEATED' : s.status,
        score,
        exam.total_marks,
        pct + '%',
        isCheated ? 'VOID' : (s.grade || 'N/A'),
        correctCount,
        wrongCount,
        unanswered,
        isCheated ? 'YES' : 'No',
        s.submit_time ? new Date(s.submit_time).toLocaleString() : '',
      ];

      // Per-question answer + marks earned
      questions.forEach(function(q) {
        var ans      = stuAnswers[q.question_id] || '';
        var isCorrect= ans && ['MCQ','TRUE_FALSE'].includes(q.question_type) &&
                       ans.trim().toLowerCase() === (q.correct_answer || '').trim().toLowerCase();
        var marksEarned = isCheated ? 0 : (isCorrect ? q.marks : (q.question_type === 'SHORT_ANSWER' || q.question_type === 'DESCRIPTIVE' ? 'AI Graded' : 0));
        row.push(ans || '(no answer)');
        row.push(marksEarned);
      });

      rows.push(csvRow(row));
    });

    rows.push('');
    rows.push(csvRow(['--- End of Report ---']));
    rows.push(csvRow(['Generated by DExam', new Date().toISOString()]));

    var csvContent = rows.join('\r\n');
    var filename   = (exam.title || 'exam').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_results.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send('\uFEFF' + csvContent); // BOM for Excel UTF-8 compatibility

  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

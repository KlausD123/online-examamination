const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Start exam
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const { exam_id } = req.body;
    
    // Validate exam is published
    const [[exam]] = await pool.query('SELECT status FROM exams WHERE exam_id = ?', [exam_id]);
    if (!exam || exam.status !== 'published') {
      return res.status(400).json({ error: 'Exam is not available' });
    }
    
    // Check if already started/completed
    const [[existing]] = await pool.query('SELECT * FROM submissions WHERE exam_id = ? AND student_id = ?', [exam_id, req.user.user_id]);
    
    if (existing) {
      if (existing.status !== 'in_progress') {
        return res.status(400).json({ error: 'Exam already completed' });
      }
      return res.json({ submission_id: existing.submission_id, message: 'Resumed exam' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO submissions (exam_id, student_id, start_time, status) VALUES (?, ?, NOW(), "in_progress")',
      [exam_id, req.user.user_id]
    );
    
    res.status(201).json({ submission_id: result.insertId, message: 'Exam started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit exam
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { submission_id, answers, exam_id, cheated } = req.body;
    
    const [[submission]] = await pool.query('SELECT * FROM submissions WHERE submission_id = ?', [submission_id]);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    
    if (submission.student_id !== req.user.user_id) {
      return res.status(403).json({ error: 'Not your submission' });
    }
    if (submission.status !== 'in_progress') {
      return res.status(400).json({ error: 'Already submitted' });
    }
    
    const status = cheated ? 'cheated' : 'submitted';
    await pool.query('UPDATE submissions SET status = ?, submit_time = NOW() WHERE submission_id = ?', [status, submission_id]);
    
    let totalScore = 0;
    
    // Process answers and auto-grade
    if (!cheated && answers && answers.length > 0) {
      for (const ans of answers) {
        const { question_id, answer_text } = ans;
        await pool.query(
          'INSERT INTO answers (submission_id, question_id, answer_text) VALUES (?, ?, ?)',
          [submission_id, question_id, answer_text || '']
        );
        
        // Simple auto-grading for MCQ/TRUE_FALSE
        const [[question]] = await pool.query('SELECT question_type as type, marks, correct_answer FROM questions WHERE question_id = ?', [question_id]);
        if (question && ['MCQ', 'TRUE_FALSE'].includes(question.type) && question.correct_answer === answer_text) {
          totalScore += question.marks;
        }
      }
    }
    
    const [[exam]] = await pool.query('SELECT total_marks FROM exams WHERE exam_id = ?', [exam_id]);
    const scorePct = (totalScore / exam.total_marks) * 100;
    let grade = 'F';
    if (scorePct >= 90) grade = 'A';
    else if (scorePct >= 80) grade = 'B';
    else if (scorePct >= 70) grade = 'C';
    else if (scorePct >= 60) grade = 'D';
    
    await pool.query(
      'INSERT INTO results (submission_id, total_score, grade, cheating_detected) VALUES (?, ?, ?, ?)',
      [submission_id, totalScore, grade, cheated ? 1 : 0]
    );
    
    res.json({ message: 'Exam submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Student gets their own submissions
router.get('/student/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.user_id != req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const [submissions] = await pool.query(`
      SELECT s.*, e.title, e.total_marks, r.total_score, r.grade, r.cheating_detected
      FROM submissions s
      JOIN exams e ON s.exam_id = e.exam_id
      LEFT JOIN results r ON s.submission_id = r.submission_id
      WHERE s.student_id = ?
      ORDER BY s.start_time DESC
    `, [req.params.id]);
    
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific result details
router.get('/result/:id', authenticateToken, async (req, res) => {
  try {
    const [[result]] = await pool.query(`
      SELECT r.*, s.student_id, e.total_marks, e.title
      FROM results r
      JOIN submissions s ON r.submission_id = s.submission_id
      JOIN exams e ON s.exam_id = e.exam_id
      WHERE r.submission_id = ?
    `, [req.params.id]);
    
    if (!result) return res.status(404).json({ error: 'Result not found' });
    
    if (result.student_id !== req.user.user_id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get answers for submission
router.get('/answers/:id', authenticateToken, async (req, res) => {
  try {
    const [[submission]] = await pool.query('SELECT student_id FROM submissions WHERE submission_id = ?', [req.params.id]);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    
    if (submission.student_id !== req.user.user_id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const [answers] = await pool.query('SELECT * FROM answers WHERE submission_id = ?', [req.params.id]);
    res.json(answers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin gets all submissions for an exam
router.get('/exam/:id', requireAdmin, async (req, res) => {
  try {
    const [submissions] = await pool.query(`
      SELECT s.*, u.name, u.email, r.total_score, r.grade, r.cheating_detected
      FROM submissions s
      JOIN users u ON s.student_id = u.user_id
      LEFT JOIN results r ON s.submission_id = r.submission_id
      WHERE s.exam_id = ?
      ORDER BY s.submit_time DESC
    `, [req.params.id]);
    
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

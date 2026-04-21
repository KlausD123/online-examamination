const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const updateTotalMarks = async (exam_id) => {
  await pool.query(
    'UPDATE exams SET total_marks = (SELECT COALESCE(SUM(marks),0) FROM questions WHERE exam_id=?) WHERE exam_id=?',
    [exam_id, exam_id]
  );
};

// Get questions for exam
router.get('/:exam_id', authenticateToken, async (req, res) => {
  try {
    const { exam_id } = req.params;
    const [questions] = await pool.query('SELECT * FROM questions WHERE exam_id = ? ORDER BY question_order ASC', [exam_id]);
    
    // SECURITY: Strip correct_answer and explanation for students who haven't completed
    if (req.user.role === 'student') {
      const [submissions] = await pool.query(
        'SELECT status FROM submissions WHERE exam_id = ? AND student_id = ?', 
        [exam_id, req.user.user_id]
      );
      
      const isCompleted = submissions.length > 0 && ['submitted', 'cheated'].includes(submissions[0].status);
      
      if (!isCompleted) {
        questions.forEach(q => {
          delete q.correct_answer;
          delete q.explanation;
        });
      }
    }
    
    // Fetch options for each question
    for (let i = 0; i < questions.length; i++) {
      const [options] = await pool.query('SELECT * FROM options WHERE question_id = ? ORDER BY option_order ASC', [questions[i].question_id]);
      questions[i].options = options;
    }
    
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create question(s)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (items.length === 0) return res.status(400).json({ error: 'No questions provided' });
    
    const exam_id = items[0].exam_id;
    
    for (const item of items) {
      const { question_text, question_type, difficulty, marks, correct_answer, explanation, question_order, options } = item;
      
      const [result] = await pool.query(
        'INSERT INTO questions (exam_id, question_text, question_type, difficulty, marks, correct_answer, explanation, question_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [exam_id, question_text, question_type || 'MCQ', difficulty || 'Medium', marks || 10, correct_answer || '', explanation || '', question_order || 0]
      );
      
      const question_id = result.insertId;
      
      if (options && Array.isArray(options)) {
        for (let i = 0; i < options.length; i++) {
          await pool.query(
            'INSERT INTO options (question_id, text, option_order) VALUES (?, ?, ?)',
            [question_id, options[i].text || options[i], i]
          );
        }
      }
    }
    
    await updateTotalMarks(exam_id);
    
    res.status(201).json({ message: 'Questions added successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete question
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const [[question]] = await pool.query('SELECT exam_id FROM questions WHERE question_id = ?', [req.params.id]);
    if (!question) return res.status(404).json({ error: 'Question not found' });
    
    await pool.query('DELETE FROM questions WHERE question_id = ?', [req.params.id]);
    await updateTotalMarks(question.exam_id);
    
    res.json({ message: 'Question deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, department, year } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });
    
    const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) return res.status(400).json({ error: 'Email already exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const [userResult] = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, 'student']
    );
    
    await pool.query(
      'INSERT INTO students (user_id, department, year) VALUES (?, ?, ?)',
      [userResult.insertId, department || '', year || '1st Year']
    );
    
    res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });
    
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
    
    const user = users[0];
    let passwordMatch = false;
    
    const isBcrypt = user.password.startsWith('$2b$') || user.password.startsWith('$2a$');
    
    if (isBcrypt) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      passwordMatch = (password === user.password);
      if (passwordMatch) {
        // Auto-upgrade plain text to bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedPassword, user.user_id]);
      }
    }
    
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid email or password' });
    
    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { user_id: user.user_id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.user.user_id]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = users[0];
    const isBcrypt = user.password.startsWith('$2b$') || user.password.startsWith('$2a$');
    let passwordMatch = isBcrypt ? await bcrypt.compare(oldPassword, user.password) : (oldPassword === user.password);
    
    if (!passwordMatch) return res.status(401).json({ error: 'Incorrect old password' });
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedPassword, req.user.user_id]);
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

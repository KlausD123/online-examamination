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

// ── In-memory OTP store (resets on server restart — fine for MVP) ──
const otpStore = {}; // { email: { otp, expires } }

// Forgot password — send OTP to email
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const [users] = await pool.query('SELECT user_id FROM users WHERE email = ?', [email]);
    // Always respond OK — don't reveal if email exists
    if (users.length === 0) return res.json({ message: 'If that email exists, a code was sent.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
    otpStore[email] = { otp, expires: Date.now() + 10 * 60 * 1000 }; // 10 min

    // Send email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from:    `"DExam" <${process.env.SMTP_USER}>`,
      to:      email,
      subject: 'Your DExam Password Reset Code',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a14;color:#e5e5e5;border-radius:12px;">
          <div style="font-size:2rem;margin-bottom:8px;">🎓 DExam</div>
          <h2 style="color:#a78bfa;margin:0 0 16px">Password Reset</h2>
          <p>Use the code below to reset your password. It expires in <strong>10 minutes</strong>.</p>
          <div style="font-size:2.5rem;font-weight:900;letter-spacing:12px;color:#7c3aed;background:rgba(124,58,237,.12);border:2px solid rgba(124,58,237,.3);border-radius:10px;padding:20px;text-align:center;margin:24px 0;">${otp}</div>
          <p style="color:#9ca3af;font-size:0.85rem;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    res.json({ message: 'If that email exists, a code was sent.' });
  } catch(e) {
    console.error('[forgot-password]', e.message);
    res.status(500).json({ error: 'Could not send email. Check SMTP config.' });
  }
});

// Reset password — verify OTP and set new password
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) return res.status(400).json({ error: 'Email, OTP and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: 'No reset code found — request a new one' });
  if (Date.now() > record.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Code expired — request a new one' });
  }
  if (record.otp !== otp.trim()) return res.status(400).json({ error: 'Invalid code' });

  try {
    const bcrypt = require('bcrypt');
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE email = ?', [hashed, email]);
    delete otpStore[email];
    res.json({ message: 'Password reset successfully! You can now log in.' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

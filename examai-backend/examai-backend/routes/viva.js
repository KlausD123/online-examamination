const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Create viva session
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { title, topic, questions } = req.body;
    const viva_id = uuidv4();
    
    await pool.query(
      'INSERT INTO viva_sessions (viva_id, title, topic, questions, questions_count, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [viva_id, title, topic, JSON.stringify(questions), questions.length, req.user.user_id]
    );
    
    res.status(201).json({ viva_id, message: 'Viva session created' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get admin's past sessions
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [sessions] = await pool.query('SELECT * FROM viva_sessions WHERE created_by = ? ORDER BY created_at DESC', [req.user.user_id]);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all viva results for admin (student-wise) — all sessions visible to any admin
router.get('/all-results', requireAdmin, async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT vr.result_id, vr.viva_id, vr.student_id, vr.student_name,
        vr.total_score, vr.grade, vr.correct_count, vr.total_questions,
        vr.result_visible, vr.created_at,
        vs.title, vs.topic, vs.course_id,
        u.email as student_email
      FROM viva_results vr
      JOIN viva_sessions vs ON vr.viva_id = vs.viva_id
      LEFT JOIN users u ON vr.student_id = u.user_id
      ORDER BY vr.created_at DESC
    `);
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CSV data for export ───────────────────────────────────────
router.get('/:viva_id/results-csv-data', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT vr.student_name, vr.total_score, vr.grade, vr.correct_count,
        vr.total_questions, vr.created_at, vs.title, vs.topic,
        u.email as student_email
      FROM viva_results vr
      JOIN viva_sessions vs ON vr.viva_id = vs.viva_id
      LEFT JOIN users u ON vr.student_id = u.user_id
      WHERE vr.viva_id = ?
      ORDER BY vr.total_score DESC
    `, [req.params.viva_id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Export viva results as CSV ────────────────────────────────
router.get('/:viva_id/export-csv', requireAdmin, async (req, res) => {
  try {
    const [results] = await pool.query(
      'SELECT vr.student_name, vr.total_score, vr.grade, vr.correct_count, vr.total_questions, vr.created_at, vs.title, vs.topic FROM viva_results vr JOIN viva_sessions vs ON vr.viva_id = vs.viva_id WHERE vr.viva_id = ? ORDER BY vr.total_score DESC',
      [req.params.viva_id]
    );
    var title = results.length > 0 ? results[0].title : 'viva';
    var csv = 'Student Name,Score (%),Grade,Correct,Total Questions,Session,Topic,Date\n';
    results.forEach(function(r) {
      csv += [
        r.student_name||'Unknown', r.total_score||0, r.grade||'F',
        r.correct_count||0, r.total_questions||0,
        (r.title||'').replace(/,/g,''), (r.topic||'').replace(/,/g,''),
        new Date(r.created_at).toLocaleDateString()
      ].join(',') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="' + title.replace(/[^a-z0-9]/gi,'_') + '_results.csv"');
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get student's viva results
router.get('/my-results', authenticateToken, async (req, res) => {
  try {
    const [results] = await pool.query(
      'SELECT r.*, s.title, s.topic FROM viva_results r JOIN viva_sessions s ON r.viva_id = s.viva_id WHERE r.student_id = ? AND (r.result_visible = 1 OR r.result_visible IS NULL) ORDER BY r.created_at DESC',
      [req.user.user_id]
    );
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch session (for student join)
router.get('/:viva_id', authenticateToken, async (req, res) => {
  try {
    const [[session]] = await pool.query('SELECT * FROM viva_sessions WHERE viva_id = ?', [req.params.viva_id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save AI-graded result — called once per student after finalize
router.post('/:viva_id/result', requireAdmin, async (req, res) => {
  try {
    const { student_id, student_name, total_score, grade, correct_count, total_questions, full_transcript, ai_report } = req.body;

    // Delete any prior result for this student+session (re-finalize case)
    if (student_id) {
      await pool.query('DELETE FROM viva_results WHERE viva_id = ? AND student_id = ?', [req.params.viva_id, student_id]);
    }

    await pool.query(
      'INSERT INTO viva_results (viva_id, student_id, student_name, total_score, grade, correct_count, total_questions, full_transcript, ai_report, result_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
      [req.params.viva_id, student_id || null, student_name || 'Unknown', total_score || 0, grade || 'F', correct_count || 0, total_questions || 0, full_transcript || '', JSON.stringify(ai_report || {})]
    );

    // Notify the student their result is ready
    if (student_id) {
      await pool.query(
        'INSERT INTO notifications (title, message, type, admin_id, recipient_id) VALUES (?, ?, ?, ?, ?)',
        ['Viva Result Available', 'Your oral viva result is ready. Check My Results → Viva tab to see your score, transcript, and AI analysis.', 'success', req.user.user_id, student_id]
      );
    }

    res.status(201).json({ message: 'Result saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle result visibility for student
router.post('/:viva_id/result/:result_id/visibility', requireAdmin, async (req, res) => {
  try {
    const { visible } = req.body;
    await pool.query(
      'UPDATE viva_results SET result_visible = ? WHERE result_id = ? AND viva_id = ?',
      [visible ? 1 : 0, req.params.result_id, req.params.viva_id]
    );
    res.json({ message: 'Visibility updated', visible: !!visible });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send invite
router.post('/invite', requireAdmin, async (req, res) => {
  try {
    const { emails, title, topic, vivaId } = req.body;
    if (!emails || emails.length === 0) return res.status(400).json({ error: 'No emails provided' });
    
    var sentCount = 0;
    
    for (var i = 0; i < emails.length; i++) {
      var emailAddr = emails[i].trim();
      var rows = await pool.query('SELECT user_id FROM users WHERE email = ?', [emailAddr]);
      var user = rows[0][0];
      if (user) {
        var msgTitle = 'Viva Invitation: ' + title;
        var msgBody = 'You have been invited to join a Viva session on ' + topic + '.';
        await pool.query(
          'INSERT INTO notifications (title, message, type, admin_id, recipient_id, viva_room_id) VALUES (?, ?, "urgent", ?, ?, ?)',
          [msgTitle, msgBody, req.user.user_id, user.user_id, vivaId]
        );
        sentCount++;
      }
    }
    
    res.json({ message: 'Invited ' + sentCount + ' students' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel all pending invitations for a viva room (called when session ends)
router.post('/:viva_id/cancel-invites', requireAdmin, async (req, res) => {
  try {
    const { viva_id } = req.params;

    // Get all students who were invited to this room
    const [invites] = await pool.query(
      'SELECT DISTINCT recipient_id FROM notifications WHERE viva_room_id = ? AND recipient_id IS NOT NULL',
      [viva_id]
    );

    // Mark original invitations as dismissed by updating their type to "expired"
    await pool.query(
      'UPDATE notifications SET type = "expired", title = CONCAT("[Ended] ", title), message = "This viva session has ended." WHERE viva_room_id = ? AND title NOT LIKE "[Ended]%"',
      [viva_id]
    );

    // Send a "session ended" notification to each invited student
    for (const invite of invites) {
      if (!invite.recipient_id) continue;
      await pool.query(
        'INSERT INTO notifications (title, message, type, admin_id, recipient_id, viva_room_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
          'Viva Session Ended',
          'The viva session you were invited to has ended. No further action needed.',
          'info',
          req.user.user_id,
          invite.recipient_id,
          viva_id
        ]
      );
    }

    res.json({ message: 'Invitations cancelled', count: invites.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark session as ended — clears all invitations from every invited student
router.post('/:viva_id/end', requireAdmin, async (req, res) => {
  try {
    const viva_id = req.params.viva_id;

    // 1. Mark session ended
    await pool.query(
      'UPDATE viva_sessions SET status = "ended", ended_at = NOW() WHERE viva_id = ? AND created_by = ?',
      [viva_id, req.user.user_id]
    );

    // 2. Get every student who received an invitation for this room
    const [invites] = await pool.query(
      'SELECT DISTINCT recipient_id FROM notifications WHERE viva_room_id = ? AND recipient_id IS NOT NULL',
      [viva_id]
    );

    // 3. Delete all invitation notifications for this room so they vanish from student inboxes
    await pool.query(
      'DELETE FROM notifications WHERE viva_room_id = ?',
      [viva_id]
    );

    // 4. Send a clean "session ended" notification to each invited student
    for (const invite of invites) {
      if (!invite.recipient_id) continue;
      await pool.query(
        'INSERT INTO notifications (title, message, type, admin_id, recipient_id) VALUES (?, ?, ?, ?, ?)',
        [
          'Viva Session Ended',
          'The viva session has ended. Check My Results for your grade.',
          'info',
          req.user.user_id,
          invite.recipient_id
        ]
      );
    }

    res.json({ message: 'Session ended', invites_cleared: invites.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark session as locked (examiner away > 10 min) — also clears invitations
router.post('/:viva_id/lock', requireAdmin, async (req, res) => {
  try {
    const viva_id = req.params.viva_id;

    await pool.query(
      'UPDATE viva_sessions SET status = "locked", ended_at = NOW() WHERE viva_id = ? AND created_by = ?',
      [viva_id, req.user.user_id]
    );

    const [invites] = await pool.query(
      'SELECT DISTINCT recipient_id FROM notifications WHERE viva_room_id = ? AND recipient_id IS NOT NULL',
      [viva_id]
    );

    await pool.query('DELETE FROM notifications WHERE viva_room_id = ?', [viva_id]);

    for (const invite of invites) {
      if (!invite.recipient_id) continue;
      await pool.query(
        'INSERT INTO notifications (title, message, type, admin_id, recipient_id) VALUES (?, ?, ?, ?, ?)',
        ['Viva Session Expired', 'The examiner was unavailable — the session has been cancelled.', 'info', req.user.user_id, invite.recipient_id]
      );
    }

    res.json({ message: 'Session locked', invites_cleared: invites.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── WebRTC signaling: store/retrieve SDP offers and ICE candidates ──
// Admin stores offer → Student reads it and sends answer → Admin reads answer
var signalingStore = {}; // in-memory: { viva_id: { offer, answer, adminCandidates:[], studentCandidates:[] } }

router.post('/:viva_id/signal/offer', authenticateToken, async (req, res) => {
  var id = req.params.viva_id;
  // Fresh offer = reset everything for this room
  signalingStore[id] = { adminCandidates: [], studentCandidates: [], offer: req.body.offer, answer: null };
  res.json({ ok: true });
});

router.get('/:viva_id/signal/offer', authenticateToken, async (req, res) => {
  var id = req.params.viva_id;
  res.json({ offer: signalingStore[id] ? signalingStore[id].offer : null });
});

router.post('/:viva_id/signal/answer', authenticateToken, async (req, res) => {
  var id = req.params.viva_id;
  if (!signalingStore[id]) signalingStore[id] = { adminCandidates: [], studentCandidates: [] };
  signalingStore[id].answer = req.body.answer;
  res.json({ ok: true });
});

router.get('/:viva_id/signal/answer', authenticateToken, async (req, res) => {
  var id = req.params.viva_id;
  res.json({ answer: signalingStore[id] ? signalingStore[id].answer : null });
});

router.post('/:viva_id/signal/candidate', authenticateToken, async (req, res) => {
  var id = req.params.viva_id;
  if (!signalingStore[id]) signalingStore[id] = { adminCandidates: [], studentCandidates: [] };
  var role = req.body.role; // 'admin' or 'student'
  var candidate = req.body.candidate;
  if (role === 'admin') signalingStore[id].adminCandidates.push(candidate);
  else signalingStore[id].studentCandidates.push(candidate);
  res.json({ ok: true });
});

router.get('/:viva_id/signal/candidates/:role', authenticateToken, async (req, res) => {
  var id   = req.params.viva_id;
  var role = req.params.role; // 'admin' or 'student'
  var data = signalingStore[id] || { adminCandidates: [], studentCandidates: [] };
  res.json({ candidates: role === 'admin' ? data.adminCandidates : data.studentCandidates });
});

module.exports = router;

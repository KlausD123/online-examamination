require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/exams',         require('./routes/exams'));
app.use('/api/questions',     require('./routes/questions'));
app.use('/api/submissions',   require('./routes/submissions'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/viva',          require('./routes/viva'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/students',      require('./routes/students'));
app.use('/api/profile',       require('./routes/profile'));

app.post('/api/ai/chat', require('./middleware/auth').authenticateToken, async (req, res) => {
  const { messages, max_tokens, temperature } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'AI not configured' });
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', max_tokens: Math.min(Number(max_tokens)||1000,4000), temperature: Number(temperature)||0.7, messages }),
    });
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── WebRTC Signaling Server ──────────────────────────────────────────────────
// Each viva room: one admin, one or more students
// Signaling flow:
//   1. Both join room via socket
//   2. Admin creates offer → sends to student
//   3. Student creates answer → sends to admin  
//   4. Both exchange ICE candidates
//   5. WebRTC peer connection established (direct video/audio)

const rooms = {}; // { viva_id: { adminId: socketId, students: [socketId] } }

io.on('connection', (socket) => {

  socket.on('join-viva', ({ viva_id, role, name }) => {
    socket.data = { viva_id, role, name: name || role };
    socket.join(viva_id);

    if (!rooms[viva_id]) rooms[viva_id] = { adminId: null, students: [] };
    const room = rooms[viva_id];

    if (role === 'admin') {
      room.adminId = socket.id;
      // Tell any already-waiting students that admin is here
      room.students.forEach(sid => io.to(sid).emit('admin-ready', { adminId: socket.id }));
    } else {
      room.students.push(socket.id);
      // Tell admin a student joined so admin can initiate offer
      if (room.adminId) {
        io.to(room.adminId).emit('student-joined', { studentId: socket.id, name: socket.data.name });
        // Also tell student admin is here (in case student joined after admin)
        socket.emit('admin-ready', { adminId: room.adminId });
      }
    }

    console.log(`[VIVA] ${role} "${name}" joined ${viva_id} | admin:${!!room.adminId} students:${room.students.length}`);
    socket.emit('room-joined', { viva_id, role, yourId: socket.id });
  });

  // WebRTC: admin sends offer to specific student
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  // WebRTC: student sends answer to admin
  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  // WebRTC: ICE candidates (both directions)
  socket.on('ice', ({ to, candidate }) => {
    io.to(to).emit('ice', { from: socket.id, candidate });
  });

  // Admin ends session
  socket.on('end-viva', ({ viva_id }) => {
    socket.to(viva_id).emit('viva-ended');
    delete rooms[viva_id];
  });

  socket.on('disconnect', () => {
    const { viva_id, role } = socket.data || {};
    if (!viva_id || !rooms[viva_id]) return;
    const room = rooms[viva_id];
    if (role === 'admin') {
      room.adminId = null;
      socket.to(viva_id).emit('admin-left');
    } else {
      room.students = room.students.filter(id => id !== socket.id);
      if (room.adminId) io.to(room.adminId).emit('student-left', { studentId: socket.id });
    }
    console.log(`[VIVA] ${role} disconnected from ${viva_id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n✅ DExam Backend → http://localhost:${PORT}`);
  console.log(`   WebRTC signaling: ready`);
  console.log(`   DB: ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);
});

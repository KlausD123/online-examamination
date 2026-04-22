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

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use((req, res) => res.status(404).json({ error: 'Route not found: ' + req.method + ' ' + req.path }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// Socket.IO real-time WebRTC signaling
const rooms = {};

io.on('connection', (socket) => {

  socket.on('join-room', ({ viva_id, role, name }) => {
    socket.join(viva_id);
    socket.data.viva_id = viva_id;
    socket.data.role    = role;
    socket.data.name    = name || role;
    if (!rooms[viva_id]) rooms[viva_id] = { admin: null, students: [] };

    if (role === 'admin') {
      rooms[viva_id].admin = socket.id;
      // Tell all existing students that admin joined
      socket.to(viva_id).emit('admin-joined', { socketId: socket.id });
      // Also tell admin about any students already in the room
      const existing = rooms[viva_id].students;
      if (existing.length > 0) {
        existing.forEach(function(sid) {
          const s = io.sockets.sockets.get(sid);
          socket.emit('student-joined', { socketId: sid, name: s ? s.data.name : 'Student' });
        });
      }
    } else {
      if (!rooms[viva_id].students.includes(socket.id))
        rooms[viva_id].students.push(socket.id);
      // Tell admin a new student joined
      const adminId = rooms[viva_id].admin;
      if (adminId) {
        io.to(adminId).emit('student-joined', { socketId: socket.id, name: socket.data.name });
      }
      // If admin already in room, ask admin to send an offer
      if (adminId) {
        socket.emit('admin-joined', { socketId: adminId });
      }
    }
    console.log('[VIVA]', role, name, 'joined', viva_id, '| students:', rooms[viva_id].students.length, '| admin:', !!rooms[viva_id].admin);
  });

  socket.on('offer', ({ viva_id, to, offer }) => {
    const target = to || (rooms[viva_id] && rooms[viva_id].students[0]);
    if (target) io.to(target).emit('offer', { from: socket.id, offer });
    else socket.to(viva_id).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ viva_id, to, answer }) => {
    const target = to || (rooms[viva_id] && rooms[viva_id].admin);
    if (target) io.to(target).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ viva_id, to, candidate }) => {
    if (to) { io.to(to).emit('ice-candidate', { from: socket.id, candidate }); return; }
    if (socket.data.role === 'admin') {
      ((rooms[viva_id] && rooms[viva_id].students) || []).forEach(function(sid) { io.to(sid).emit('ice-candidate', { from: socket.id, candidate }); });
    } else {
      const adminId = rooms[viva_id] && rooms[viva_id].admin;
      if (adminId) io.to(adminId).emit('ice-candidate', { from: socket.id, candidate });
    }
  });

  socket.on('end-session', ({ viva_id }) => {
    socket.to(viva_id).emit('session-ended');
    if (rooms[viva_id]) delete rooms[viva_id];
  });

  socket.on('disconnect', () => {
    const { viva_id, role } = socket.data;
    if (!viva_id || !rooms[viva_id]) return;
    if (role === 'admin') { rooms[viva_id].admin = null; socket.to(viva_id).emit('admin-left'); }
    else {
      rooms[viva_id].students = (rooms[viva_id].students||[]).filter(id => id !== socket.id);
      const adminId = rooms[viva_id].admin;
      if (adminId) io.to(adminId).emit('student-left', { socketId: socket.id });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('\n✅ DExam Backend  →  http://localhost:' + PORT);
  console.log('   Socket.IO: real-time WebRTC signaling ready');
  console.log('   Groq AI  : ' + (process.env.GROQ_API_KEY ? 'configured' : 'not configured'));
  console.log('   Database : ' + process.env.DB_NAME + '@' + process.env.DB_HOST + '\n');
});

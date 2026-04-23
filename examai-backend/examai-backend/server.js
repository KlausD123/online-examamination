require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
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
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── WebRTC Signaling via Socket.IO ───────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('join-viva-room', ({ vivaId, role, userName }) => {
    socket.join(vivaId);
    socket.vivaId   = vivaId;
    socket.vivaRole = role;
    socket.vivaName = userName || role;
    console.log('[Viva]', role, '"' + socket.vivaName + '" joined room', vivaId);

    // Tell everyone else someone joined
    socket.to(vivaId).emit('peer-joined', { role, userName: socket.vivaName, socketId: socket.id });

    // Tell the joiner who is already in the room
    const roomSockets = io.sockets.adapter.rooms.get(vivaId);
    if (roomSockets) {
      const members = [];
      roomSockets.forEach((sid) => {
        const s = io.sockets.sockets.get(sid);
        if (s && sid !== socket.id) members.push({ socketId: sid, role: s.vivaRole, userName: s.vivaName });
      });
      socket.emit('room-members', members);
    }
  });

  socket.on('webrtc-offer', (data) => {
    console.log('[WebRTC] Offer from', socket.vivaRole, 'in room', data.vivaId);
    socket.to(data.vivaId).emit('webrtc-offer', { offer: data.offer, fromSocketId: socket.id, fromRole: socket.vivaRole, fromName: socket.vivaName });
  });

  socket.on('webrtc-answer', (data) => {
    console.log('[WebRTC] Answer from', socket.vivaRole, 'in room', data.vivaId);
    socket.to(data.vivaId).emit('webrtc-answer', { answer: data.answer, fromSocketId: socket.id, fromRole: socket.vivaRole });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.vivaId).emit('webrtc-ice-candidate', { candidate: data.candidate, fromSocketId: socket.id });
  });

  // Admin → student: request student to start camera
  socket.on('request-camera', (data) => {
    console.log('[Admin] requesting student camera in room', data.vivaId);
    socket.to(data.vivaId).emit('camera-requested', { fromAdmin: socket.vivaName });
  });

  // Student → admin: camera is now ready
  socket.on('camera-ready', (data) => {
    console.log('[Student] camera ready in room', data.vivaId);
    socket.to(data.vivaId).emit('student-camera-ready', { studentName: socket.vivaName });
  });

  // Admin → student: stop camera
  socket.on('stop-camera', (data) => {
    socket.to(data.vivaId).emit('camera-stop', {});
  });

  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected:', socket.id);
    if (socket.vivaId) {
      socket.to(socket.vivaId).emit('peer-left', { role: socket.vivaRole, userName: socket.vivaName, socketId: socket.id });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('\n✅ DExam Backend + WebRTC Signaling → http://localhost:' + PORT + '\n');
});

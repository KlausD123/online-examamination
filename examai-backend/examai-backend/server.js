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

// Debug endpoint — see all rooms and who's in them
app.get('/api/debug/rooms', (req, res) => {
  const result = {};
  io.sockets.adapter.rooms.forEach((sids, roomId) => {
    if (roomId.length > 10) { // skip socket-id rooms
      const members = [];
      sids.forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) members.push({ id: sid, role: s.vivaRole, name: s.vivaName });
      });
      result[roomId] = members;
    }
  });
  res.json(result);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/test', (req, res) => res.sendFile(require('path').join(__dirname, 'test-viva.html')));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── WebRTC Signaling ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 New socket:', socket.id);

  socket.on('join-viva-room', ({ vivaId, role, userName }) => {
    socket.join(vivaId);
    socket.vivaId   = vivaId;
    socket.vivaRole = role;
    socket.vivaName = userName || role;

    // Who else is already here?
    const room = io.sockets.adapter.rooms.get(vivaId);
    const others = [];
    if (room) {
      room.forEach(sid => {
        if (sid !== socket.id) {
          const s = io.sockets.sockets.get(sid);
          if (s) others.push({ socketId: sid, role: s.vivaRole, userName: s.vivaName });
        }
      });
    }

    console.log(`[ROOM] ${role} "${userName}" → room ${vivaId} | others: ${JSON.stringify(others)}`);

    // Tell others this person joined
    socket.to(vivaId).emit('peer-joined', { role, userName: socket.vivaName, socketId: socket.id });

    // Tell this person who's already here
    socket.emit('room-members', others);
  });

  socket.on('webrtc-offer', (data) => {
    console.log(`[OFFER] ${socket.vivaRole} → room ${data.vivaId}`);
    socket.to(data.vivaId).emit('webrtc-offer', { offer: data.offer, fromSocketId: socket.id });
  });

  socket.on('webrtc-answer', (data) => {
    console.log(`[ANSWER] ${socket.vivaRole} → room ${data.vivaId}`);
    socket.to(data.vivaId).emit('webrtc-answer', { answer: data.answer, fromSocketId: socket.id });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.vivaId).emit('webrtc-ice-candidate', { candidate: data.candidate, fromSocketId: socket.id });
  });

  // Admin sends question text → relay to student so they can read it
  socket.on('question-text', (data) => {
    socket.to(data.vivaId).emit('question-text', { text: data.text });
  });

  socket.on('request-camera', (data) => {
    console.log(`[CAM-REQ] admin → room ${data.vivaId}`);
    socket.to(data.vivaId).emit('camera-requested', { fromAdmin: socket.vivaName });
  });

  socket.on('camera-ready', (data) => {
    console.log(`[CAM-READY] student → room ${data.vivaId}`);
    socket.to(data.vivaId).emit('student-camera-ready', { studentName: socket.vivaName });
  });

  socket.on('stop-camera', (data) => {
    socket.to(data.vivaId).emit('camera-stop', {});
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Disconnected: ${socket.id} (${socket.vivaRole || '?'} in ${socket.vivaId || '?'})`);
    if (socket.vivaId) {
      socket.to(socket.vivaId).emit('peer-left', { role: socket.vivaRole, userName: socket.vivaName, socketId: socket.id });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n✅ DExam Backend → http://localhost:${PORT}`);
  console.log(`   Debug rooms: http://localhost:${PORT}/api/debug/rooms\n`);
});

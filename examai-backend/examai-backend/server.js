require('dotenv').config();
const initDB = await initDB();

async function startServer() {
    try {
        await initDB(); // ✅ wait for DB

        const express = require('express');
        const cors = require('cors');
        const app = express();

        app.use(cors({ origin: '*', credentials: true }));
        app.use(express.json({ limit: '10mb' }));
        app.use(express.urlencoded({ extended: true }));

        // Routes
        app.use('/api/auth', require('./routes/auth'));
        app.use('/api/exams', require('./routes/exams'));
        app.use('/api/questions', require('./routes/questions'));
        app.use('/api/submissions', require('./routes/submissions'));
        app.use('/api/notifications', require('./routes/notifications'));
        app.use('/api/viva', require('./routes/viva'));
        app.use('/api/analytics', require('./routes/analytics'));
        app.use('/api/students', require('./routes/students'));
        app.use('/api/profile', require('./routes/profile'));

        app.post('/api/ai/chat', require('./middleware/auth').authenticateToken, async(req, res) => {
            const { messages, max_tokens, temperature } = req.body;
            if (!messages || !Array.isArray(messages))
                return res.status(400).json({ error: 'messages required' });

            if (!process.env.GROQ_API_KEY)
                return res.status(503).json({ error: 'AI not configured' });

            try {
                const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + process.env.GROQ_API_KEY
                    },
                    body: JSON.stringify({
                        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
                        max_tokens: Math.min(Number(max_tokens) || 1000, 4000),
                        temperature: Number(temperature) || 0.7,
                        messages,
                    }),
                });

                const data = await r.json();
                res.json(data);

            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        app.get('/api/health', (req, res) =>
            res.json({ status: 'ok', time: new Date().toISOString() })
        );

        app.use((req, res) =>
            res.status(404).json({ error: 'Route not found: ' + req.method + ' ' + req.path })
        );

        app.use((err, req, res, next) =>
            res.status(500).json({ error: err.message })
        );

        const PORT = process.env.PORT || 5000;

        console.log("=== ENV DEBUG ===");
        console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET ✅" : "MISSING ❌");
        console.log("=================");

        app.listen(PORT, () => {
            console.log('\n✅ DExam Backend → http://localhost:' + PORT);
        });

    } catch (err) {
        console.error("❌ Server failed to start:", err.message);
        process.exit(1);
    }
}

startServer();
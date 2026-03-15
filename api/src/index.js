const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || 'http://localhost:4000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notes (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

app.get('/', (req, res) => {
    res.json({
        service: 'notes-api',
        pod: process.env.POD_NAME || 'unknown',
        logLevel: process.env.LOG_LEVEL || 'info',
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', pod: process.env.POD_NAME || 'unknown' });
});

app.get('/notes', async (req, res) => {
    const result = await pool.query('SELECT * FROM notes ORDER BY created_at DESC');
    res.json(result.rows);
});

app.post('/notes', async (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'title and content are required' });
    }
    const result = await pool.query(
        'INSERT INTO notes (title, content) VALUES ($1, $2) RETURNING *',
        [title, content]
    );
    res.status(201).json(result.rows[0]);
});

app.get('/stats', async (req, res) => {
    const response = await fetch(`${STATS_SERVICE_URL}/stats`);
    const data = await response.json();
    res.json(data);
});

app.delete('/notes/:id', async (req, res) => {
    await pool.query('DELETE FROM notes WHERE id = $1', [req.params.id]);
    res.json({ message: 'deleted' });
});

async function main() {
    await initDb();
    app.listen(PORT, () => {
        console.log(`Notes API listening on port ${PORT} | log_level=${process.env.LOG_LEVEL || 'info'} | pod=${process.env.POD_NAME || 'unknown'}`);
    });
}

main().catch(err => {
    console.error('Startup error:', err.message);
    process.exit(1);
});
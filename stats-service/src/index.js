const express = require('express');
const { Pool } = require('pg');

const app = express();

const PORT = process.env.PORT || 4000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'stats-service' });
});

app.get('/stats', async (req, res) => {
    const result = await pool.query(`
        SELECT
            COUNT(*)::int                       AS "totalNotes",
            COALESCE(ROUND(AVG(LENGTH(content))), 0)::int AS "avgContentLength",
            MIN(created_at)                     AS "oldestNote",
            MAX(created_at)                     AS "newestNote"
        FROM notes
    `);
    res.json(result.rows[0]);
});

app.listen(PORT, () => {
    console.log(`Stats service listening on port ${PORT}`);
});

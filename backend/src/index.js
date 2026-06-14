const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'tododb',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Initialize DB
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS todos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        completed BOOLEAN DEFAULT FALSE,
        priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// GET all todos
app.get('/api/todos', async (req, res) => {
  try {
    const { completed, priority, search } = req.query;
    let query = 'SELECT * FROM todos WHERE 1=1';
    const params = [];

    if (completed !== undefined) {
      params.push(completed === 'true');
      query += ` AND completed = $${params.length}`;
    }
    if (priority) {
      params.push(priority);
      query += ` AND priority = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows, count: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET single todo
app.get('/api/todos/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM todos WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Todo not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST create todo
app.post('/api/todos', async (req, res) => {
  try {
    const { title, description, priority = 'medium' } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'Title is required' });

    const result = await pool.query(
      'INSERT INTO todos (title, description, priority) VALUES ($1, $2, $3) RETURNING *',
      [title.trim(), description || null, priority]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT update todo
app.put('/api/todos/:id', async (req, res) => {
  try {
    const { title, description, priority } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'Title is required' });

    const result = await pool.query(
      `UPDATE todos SET title=$1, description=$2, priority=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [title.trim(), description || null, priority, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Todo not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH toggle completed
app.patch('/api/todos/:id/toggle', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE todos SET completed = NOT completed, updated_at=NOW() WHERE id=$1 RETURNING *',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Todo not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE todo
app.delete('/api/todos/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM todos WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Todo not found' });
    res.json({ success: true, message: 'Todo deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE all completed
app.delete('/api/todos/bulk/completed', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM todos WHERE completed = TRUE RETURNING id');
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE completed = TRUE) AS completed,
        COUNT(*) FILTER (WHERE completed = FALSE) AS pending,
        COUNT(*) FILTER (WHERE priority = 'high') AS high_priority
      FROM todos
    `);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Start server
const start = async () => {
  let retries = 10;
  while (retries > 0) {
    try {
      await initDB();
      app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
      return;
    } catch (err) {
      retries--;
      console.log(`⏳ DB not ready, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.error('❌ Could not connect to DB');
  process.exit(1);
};

start();

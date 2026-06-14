const express=require('express');
const {Pool}=require('pg');
const cors=require('cors');
require('dotenv').config();




const app=express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD, // This ensures it reads the string from .env
  port: process.env.DB_PORT,
});

app.get('/todos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM todos');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/todos', async (req, res) => {
    const {task} = req.body;
    const newTodo = await pool.query('INSERT INTO todos (task) VALUES ($1) RETURNING *', [task]);
    res.json(newTodo.rows[0]);
});

app.listen(5000, () => {
    console.log('Server is running on port 5000');
});
   
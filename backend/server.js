const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Get all todos
app.get("/todos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM todos ORDER BY id ASC"
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

// Create a todo
app.post("/todos", async (req, res) => {
  try {
    const { task } = req.body;

    if (!task || !task.trim()) {
      return res.status(400).json({
        error: "Task is required",
      });
    }

    const result = await pool.query(
      "INSERT INTO todos (task) VALUES ($1) RETURNING *",
      [task]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

// Delete a todo
app.delete("/todos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM todos WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Todo not found",
      });
    }

    res.json({
      message: "Todo deleted successfully",
      todo: result.rows[0],
    });
  } catch (err) {
    console.error("DELETE Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

app.listen(5000, () => {
  console.log("🚀 Server running on port 5000");
});
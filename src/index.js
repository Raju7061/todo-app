const express = require("express");
const pool = require("./db");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Todo App Running");
});

app.get("/todos", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM todos ORDER BY id DESC"
  );
  res.json(result.rows);
});

app.post("/todos", async (req, res) => {
  const { title } = req.body;

  const result = await pool.query(
    "INSERT INTO todos(title) VALUES($1) RETURNING *",
    [title]
  );

  res.json(result.rows[0]);
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
const pool = require("../config/db");

const getTodos = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM todos ORDER BY id DESC"
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch todos"
    });
  }
};

const createTodo = async (req, res) => {
  try {
    const { title } = req.body;

    const result = await pool.query(
      "INSERT INTO todos(title) VALUES($1) RETURNING *",
      [title]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to create todo"
    });
  }
};

const updateTodo = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE todos
      SET completed = NOT completed
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to update todo"
    });
  }
};

const deleteTodo = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      "DELETE FROM todos WHERE id = $1",
      [id]
    );

    res.json({
      message: "Todo deleted"
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to delete todo"
    });
  }
};

module.exports = {
  getTodos,
  createTodo,
  updateTodo,
  deleteTodo
};
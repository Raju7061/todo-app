require("dotenv").config();

const express = require("express");
const cors = require("cors");

const todoRoutes = require("./routes/todoRoutes");

const app = express();

app.use(cors());

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP"
  });
});

app.use("/api/todos", todoRoutes);

module.exports = app;
import { useEffect, useState } from "react";
import axios from "axios";
import TodoForm from "./components/TodoForm";
import TodoList from "./components/TodoList";
import Header from "./components/Header";
import "./App.css";

function App() {
  const [todos, setTodos] = useState([]);

  const loadTodos = async () => {
    const res = await axios.get("/api/todos");
    setTodos(res.data);
  };

  const addTodo = async (title) => {
    await axios.post("/api/todos", { title });
    loadTodos();
  };

  useEffect(() => {
    loadTodos();
  }, []);

  return (
    <div className="container">
      <Header />
      <TodoForm onAdd={addTodo} />
      <TodoList todos={todos} />
    </div>
  );
}

export default App;
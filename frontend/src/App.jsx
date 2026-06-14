import { useEffect, useState } from "react";
import axios from "axios";

function App() {
  const [todos, setTodos] = useState([]);
  const [task, setTask] = useState("");

  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    try {
      const res = await axios.get("http://localhost:5000/todos");
      setTodos(res.data);
    } catch (err) {
      console.error("Error fetching tasks:", err);
    }
  };

  const addTodo = async () => {
    if (!task.trim()) return;

    try {
      const res = await axios.post("http://localhost:5000/todos", {
        task,
      });

      setTodos([...todos, res.data]);
      setTask("");
    } catch (err) {
      console.error("Error adding task:", err);
    }
  };

  const deleteTodo = async (id) => {
    try {
      await axios.delete(`http://localhost:5000/todos/${id}`);
      setTodos(todos.filter((t) => t.id !== id));
    } catch (err) {
      console.error("Error deleting task:", err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white/90 backdrop-blur-lg rounded-3xl shadow-2xl p-6 md:p-8">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800">
            ✨ My Todo List
          </h1>
          <p className="text-gray-500 mt-2">
            Stay organized and productive
          </p>

          <div className="mt-4 inline-flex items-center px-4 py-2 rounded-full bg-indigo-100 text-indigo-700 font-semibold">
            Total Tasks: {todos.length}
          </div>
        </div>

        {/* Input Section */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTodo()}
            placeholder="What do you need to do?"
            className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />

          <button
            onClick={addTodo}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-semibold transition duration-300 shadow-md hover:shadow-lg"
          >
            Add Task
          </button>
        </div>

        {/* Todo List */}
        <div className="space-y-3">
          {todos.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              🚀 No tasks yet. Add your first task!
            </div>
          ) : (
            todos.map((t) => (
              <div
                key={t.id}
                className="group flex items-center justify-between bg-gray-50 hover:bg-indigo-50 border border-gray-200 p-4 rounded-2xl transition duration-300 shadow-sm hover:shadow-md"
              >
                <span className="text-gray-700 font-medium break-words">
                  {t.task}
                </span>

                <button
                  onClick={() => deleteTodo(t.id)}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition duration-300 ml-2"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
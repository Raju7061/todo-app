import { useEffect, useState } from 'react';
import axios from 'axios';

function App() {
  const [todos, setTodos] = useState([]);
  const [task, setTask] = useState("");

  useEffect(() => {
    axios.get('http://localhost:5000/todos').then(res => setTodos(res.data));
  }, []);

  const addTodo = async () => {
    const res = await axios.post('http://localhost:5000/todos', { task });
    setTodos([...todos, res.data]);
    setTask("");
  };

  return (
    <div>
      <input value={task} onChange={(e) => setTask(e.target.value)} />
      <button onClick={addTodo}>Add</button>
      <ul>
        {todos.map(t => <li key={t.id}>{t.task}</li>)}
      </ul>
    </div>
  );
}
export default App;
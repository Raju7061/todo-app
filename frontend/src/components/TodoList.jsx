export default function TodoList({ todos }) {
  return (
    <div className="todo-list">
      {todos.map((todo) => (
        <div className="todo-card" key={todo.id}>
          <span>{todo.title}</span>
        </div>
      ))}
    </div>
  );
}
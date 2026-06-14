import { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const PRIORITY_CONFIG = {
  high:   { label: 'High',   color: '#ff5c7c', dot: '🔴' },
  medium: { label: 'Medium', color: '#ffc947', dot: '🟡' },
  low:    { label: 'Low',    color: '#4ecca3', dot: '🟢' },
};

function TodoForm({ onAdd }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority }),
      });
      const data = await res.json();
      if (data.success) {
        onAdd(data.data);
        setTitle(''); setDescription(''); setPriority('medium'); setOpen(false);
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="form-wrapper">
      {!open ? (
        <button className="add-btn" onClick={() => setOpen(true)}>
          <span>+</span> Add New Task
        </button>
      ) : (
        <form className="todo-form" onSubmit={handleSubmit}>
          <h3>New Task</h3>
          <input
            className="form-input"
            placeholder="Task title *"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            required
          />
          <textarea
            className="form-input"
            placeholder="Description (optional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
          />
          <div className="priority-row">
            <span className="form-label">Priority</span>
            <div className="priority-btns">
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                <button
                  key={key} type="button"
                  className={`priority-btn ${priority === key ? 'active' : ''}`}
                  style={{ '--pc': cfg.color }}
                  onClick={() => setPriority(key)}
                >
                  {cfg.dot} {cfg.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Adding…' : 'Add Task'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function TodoItem({ todo, onToggle, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description || '');
  const [priority, setPriority] = useState(todo.priority);

  const handleSave = async () => {
    const res = await fetch(`${API}/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, priority }),
    });
    const data = await res.json();
    if (data.success) { onUpdate(data.data); setEditing(false); }
  };

  const pc = PRIORITY_CONFIG[todo.priority];

  if (editing) return (
    <div className="todo-item editing">
      <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} />
      <textarea className="form-input" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
      <div className="priority-btns">
        {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
          <button key={key} type="button"
            className={`priority-btn ${priority === key ? 'active' : ''}`}
            style={{ '--pc': cfg.color }}
            onClick={() => setPriority(key)}
          >
            {cfg.dot} {cfg.label}
          </button>
        ))}
      </div>
      <div className="form-actions">
        <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        <button className="btn-primary" onClick={handleSave}>Save</button>
      </div>
    </div>
  );

  return (
    <div className={`todo-item ${todo.completed ? 'done' : ''}`}>
      <button className={`check-btn ${todo.completed ? 'checked' : ''}`} onClick={() => onToggle(todo.id)}>
        {todo.completed && <span>✓</span>}
      </button>
      <div className="todo-content">
        <div className="todo-title">{todo.title}</div>
        {todo.description && <div className="todo-desc">{todo.description}</div>}
        <div className="todo-meta">
          <span className="priority-tag" style={{ color: pc.color, borderColor: pc.color }}>
            {pc.dot} {pc.label}
          </span>
          <span className="todo-date">{new Date(todo.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div className="todo-actions">
        <button className="icon-btn edit-btn" onClick={() => setEditing(true)} title="Edit">✏️</button>
        <button className="icon-btn del-btn" onClick={() => onDelete(todo.id)} title="Delete">🗑️</button>
      </div>
    </div>
  );
}

function Stats({ stats }) {
  if (!stats) return null;
  return (
    <div className="stats-bar">
      <div className="stat"><span className="stat-num">{stats.total}</span><span className="stat-label">Total</span></div>
      <div className="stat"><span className="stat-num" style={{color:'#4ecca3'}}>{stats.completed}</span><span className="stat-label">Done</span></div>
      <div className="stat"><span className="stat-num" style={{color:'#6c63ff'}}>{stats.pending}</span><span className="stat-label">Pending</span></div>
      <div className="stat"><span className="stat-num" style={{color:'#ff5c7c'}}>{stats.high_priority}</span><span className="stat-label">High Pri</span></div>
    </div>
  );
}

export default function App() {
  const [todos, setTodos] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTodos = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('completed', filter === 'completed');
      if (priority !== 'all') params.set('priority', priority);
      if (search) params.set('search', search);
      const res = await fetch(`${API}/api/todos?${params}`);
      const data = await res.json();
      if (data.success) setTodos(data.data);
      setError('');
    } catch { setError('Failed to connect to server. Is the backend running?'); }
    finally { setLoading(false); }
  }, [filter, priority, search]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats`);
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch {}
  }, []);

  useEffect(() => { fetchTodos(); fetchStats(); }, [fetchTodos, fetchStats]);

  const handleAdd = (todo) => { setTodos(p => [todo, ...p]); fetchStats(); };

  const handleToggle = async (id) => {
    const res = await fetch(`${API}/api/todos/${id}/toggle`, { method: 'PATCH' });
    const data = await res.json();
    if (data.success) { setTodos(p => p.map(t => t.id === id ? data.data : t)); fetchStats(); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this task?')) return;
    const res = await fetch(`${API}/api/todos/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { setTodos(p => p.filter(t => t.id !== id)); fetchStats(); }
  };

  const handleUpdate = (updated) => { setTodos(p => p.map(t => t.id === updated.id ? updated : t)); fetchStats(); };

  const clearCompleted = async () => {
    if (!window.confirm('Delete all completed tasks?')) return;
    const res = await fetch(`${API}/api/todos/bulk/completed`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { fetchTodos(); fetchStats(); }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">✦</span>
            <span>Taskflow</span>
          </div>
          <p className="header-sub">Stay focused. Get things done.</p>
        </div>
      </header>

      <main className="app-main">
        <Stats stats={stats} />
        <TodoForm onAdd={handleAdd} />

        <div className="filters">
          <div className="filter-group">
            {['all', 'active', 'completed'].map(f => (
              <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="filter-group">
            {['all', 'high', 'medium', 'low'].map(p => (
              <button key={p} className={`filter-btn ${priority === p ? 'active' : ''}`} onClick={() => setPriority(p)}
                style={priority === p && p !== 'all' ? { borderColor: PRIORITY_CONFIG[p]?.color } : {}}>
                {p === 'all' ? 'All Priority' : PRIORITY_CONFIG[p].dot + ' ' + PRIORITY_CONFIG[p].label}
              </button>
            ))}
          </div>
          <input
            className="search-input"
            placeholder="🔍 Search tasks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {error && <div className="error-banner">⚠️ {error}</div>}

        <div className="todos-list">
          {loading ? (
            <div className="empty-state">Loading tasks…</div>
          ) : todos.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <div>No tasks found</div>
              <small>Add a task above to get started</small>
            </div>
          ) : (
            todos.map(t => (
              <TodoItem key={t.id} todo={t} onToggle={handleToggle} onDelete={handleDelete} onUpdate={handleUpdate} />
            ))
          )}
        </div>

        {todos.some(t => t.completed) && (
          <div className="clear-row">
            <button className="btn-ghost-small" onClick={clearCompleted}>Clear completed tasks</button>
          </div>
        )}
      </main>
    </div>
  );
}

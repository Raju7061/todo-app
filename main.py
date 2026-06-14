from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# 1. Database Setup
DATABASE_URL = "postgresql://myuser:mypassword@localhost:5432/todo_db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Todo(Base):
    __tablename__ = "todos"
    id = Column(Integer, primary_key=True, index=True)
    task = Column(String)

# Create tables in the database
Base.metadata.create_all(bind=engine)

# 2. FastAPI Setup
app = FastAPI()

# 3. Routes
@app.get("/", response_class=HTMLResponse)
async def read_index():
    file_path = "templates/index.html"
    if os.path.exists(file_path):
        with open(file_path, "r") as f:
            return f.read()
    return "<h1>Error: templates/index.html not found</h1>"

@app.post("/add/{task_name}")
def add_todo(task_name: str):
    db = SessionLocal()
    new_todo = Todo(task=task_name)
    db.add(new_todo)
    db.commit()
    db.refresh(new_todo)
    return {"message": "Task added"}

@app.get("/todos")
def get_todos():
    db = SessionLocal()
    return db.query(Todo).all()
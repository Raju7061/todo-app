# ✦ Taskflow — Full-Stack Todo App

A production-ready Todo app with **React** frontend, **Node.js/Express** backend, and **PostgreSQL** database. Deployable via **Docker Compose** (local dev) or **Kubernetes on Minikube** (EC2).

---

## 📁 Project Structure

```
todo-app/
├── backend/
│   ├── src/index.js          # Express API
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.js            # React app
│   │   ├── App.css
│   │   └── index.js
│   ├── public/index.html
│   ├── Dockerfile            # Multi-stage (Node build → Nginx)
│   ├── nginx.conf
│   └── package.json
├── k8s/
│   ├── 00-namespace.yaml
│   ├── 01-configmap-secret.yaml
│   ├── 02-postgres.yaml      # PVC + Deployment + Service
│   ├── 03-backend.yaml       # Deployment + ClusterIP Service
│   ├── 04-frontend.yaml      # Deployment + NodePort Service
│   ├── 05-ingress.yaml       # Nginx Ingress
│   └── 06-hpa.yaml           # Horizontal Pod Autoscaler
├── docker-compose.yml
├── deploy-minikube.sh        # One-click deploy script
└── teardown.sh
```

---

## 🚀 Option A: Docker Compose (Local / Dev)

```bash
# Build and start all services
docker compose up --build

# App: http://localhost:3000
# API: http://localhost:5000
```

---

## ☸️ Option B: Kubernetes on Minikube (EC2)

### 1. EC2 Prerequisites

```bash
# Install Docker
sudo apt-get update
sudo apt-get install -y docker.io
sudo usermod -aG docker $USER && newgrp docker

# Install Minikube
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl
```

### 2. One-Command Deploy

```bash
git clone <your-repo>
cd todo-app
chmod +x deploy-minikube.sh
./deploy-minikube.sh
```

### 3. Manual Step-by-Step

```bash
# Start Minikube
minikube start --driver=docker --cpus=2 --memory=3g

# Enable addons
minikube addons enable ingress
minikube addons enable metrics-server

# Use Minikube's Docker daemon (IMPORTANT)
eval $(minikube docker-env)

# Build images inside Minikube
docker build -t todo-backend:latest ./backend
docker build \
  --build-arg REACT_APP_API_URL="http://$(minikube ip):30080" \
  -t todo-frontend:latest ./frontend

# Deploy
kubectl apply -f k8s/
```

### 4. Access the App

```bash
# Get Minikube IP
minikube ip

# Open in browser
open http://$(minikube ip):30080

# Access from EC2 on your local machine (SSH tunnel)
ssh -L 8080:$(minikube ip):30080 ec2-user@<EC2_PUBLIC_IP>
# Then open: http://localhost:8080
```

> **EC2 Security Group**: Open port `30080` inbound to access directly via EC2 public IP.

---

## 🔌 API Endpoints

| Method | Endpoint                    | Description              |
|--------|-----------------------------|--------------------------|
| GET    | /health                     | Health check             |
| GET    | /api/todos                  | List all todos           |
| GET    | /api/todos?completed=true   | Filter by completed      |
| GET    | /api/todos?priority=high    | Filter by priority       |
| GET    | /api/todos?search=keyword   | Search todos             |
| POST   | /api/todos                  | Create todo              |
| PUT    | /api/todos/:id              | Update todo              |
| PATCH  | /api/todos/:id/toggle       | Toggle completed         |
| DELETE | /api/todos/:id              | Delete todo              |
| DELETE | /api/todos/bulk/completed   | Delete all completed     |
| GET    | /api/stats                  | Get statistics           |

---

## 🔧 Environment Variables

### Backend
| Variable      | Default       | Description            |
|---------------|---------------|------------------------|
| PORT          | 5000          | Server port            |
| DB_HOST       | localhost     | PostgreSQL host        |
| DB_PORT       | 5432          | PostgreSQL port        |
| DB_NAME       | tododb        | Database name          |
| DB_USER       | postgres      | DB username            |
| DB_PASSWORD   | postgres123   | DB password            |
| FRONTEND_URL  | *             | CORS origin            |

---

## 🛑 Teardown

```bash
# Remove only app resources (keep Minikube)
./teardown.sh

# Stop Minikube
minikube stop

# Delete everything
minikube delete
```

# ✦ Taskflow — Full-Stack Todo App

A production-style Todo app with **React** frontend, **Node.js/Express** backend, and **PostgreSQL** (running natively on the EC2 host). Deployable via **Docker Compose** (local dev) or **Kubernetes on Minikube** (EC2), exposed through an **Nginx Ingress** with a free `nip.io` domain.

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
│   ├── Dockerfile             # Multi-stage (Node build → Nginx)
│   ├── nginx.conf
│   └── package.json
├── k8s/
│   ├── 00-namespace.yaml
│   ├── 01-configmap-secret.yaml
│   ├── 03-backend.yaml        # Deployment + ClusterIP Service
│   ├── 04-frontend.yaml       # Deployment + ClusterIP Service
│   ├── 05-ingress.yaml        # Nginx Ingress (nip.io domain)
│   └── 06-hpa.yaml            # Horizontal Pod Autoscaler
└── docker-compose.yml
```

> **Note:** There is no `02-postgres.yaml` — PostgreSQL runs natively on the EC2 host, not as a pod. Backend pods connect to it via the Minikube gateway IP.

---

## 🚀 Option A: Docker Compose (Local Dev — laptop/any machine)

```bash
cd todo-app
docker compose up --build
```
- Frontend → http://localhost:3000
- Backend API → http://localhost:5000

---

## 🚀 Option B: Run Directly (No Docker, No K8s)

```bash
# Backend
cd backend
npm install
npm start          # http://localhost:5000

# Frontend (new terminal)
cd frontend
REACT_APP_API_URL=http://localhost:5000 npm install
REACT_APP_API_URL=http://localhost:5000 npm start    # http://localhost:3000
```

---

## ☸️ Option C: Kubernetes on Minikube (EC2) — Production-style with domain

### 1. PostgreSQL setup on EC2 host (one-time)

```bash
sudo -u postgres psql
```
```sql
CREATE USER my_app_user WITH PASSWORD '1234';
CREATE DATABASE my_todo_db OWNER my_app_user;
GRANT ALL PRIVILEGES ON DATABASE my_todo_db TO my_app_user;
\q
```

Allow external connections — edit `postgresql.conf`:
```bash
sudo nano /etc/postgresql/*/main/postgresql.conf
```
```
listen_addresses = '*'
```

Edit `pg_hba.conf` — allow Minikube's Docker network:
```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
```
```
host    my_todo_db    my_app_user    192.168.49.0/24    md5
host    my_todo_db    my_app_user    172.17.0.0/16      md5
```

Restart and verify it's listening on all interfaces (not just 127.0.0.1):
```bash
sudo systemctl restart postgresql
sudo ss -tlnp | grep 5432
# Should show 0.0.0.0:5432, not 127.0.0.1:5432
```

If `ufw` is active:
```bash
sudo ufw allow from 192.168.49.0/24 to any port 5432
sudo ufw allow from 172.17.0.0/16 to any port 5432
```

### 2. Build and push Docker images

```bash
# Backend
cd backend
npm install                       # generates node_modules locally
docker build -t 2024dock/todo-backend:v1 .
docker push 2024dock/todo-backend:v1

# Frontend — REACT_APP_API_URL must match your public domain (see step 4)
cd ../frontend
npm install
docker build \
  --build-arg REACT_APP_API_URL=http://todo.<EC2_PUBLIC_IP>.nip.io \
  -t 2024dock/todo-frontend:v1 .
docker push 2024dock/todo-frontend:v1
```

> Dockerfiles use `COPY node_modules/` from local instead of installing inside the container — this avoids Docker DNS/registry timeouts and keeps builds fast (~10s instead of several minutes).

### 3. Start Minikube and deploy

```bash
minikube start --driver=docker --cpus=2 --memory=3g
minikube addons enable ingress
minikube addons enable metrics-server

kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-configmap-secret.yaml
kubectl apply -f k8s/03-backend.yaml
kubectl apply -f k8s/04-frontend.yaml
kubectl apply -f k8s/05-ingress.yaml
kubectl apply -f k8s/06-hpa.yaml
```

### 4. Find your DB_HOST value

Inside a backend pod, `host.minikube.internal` may not resolve depending on the Minikube driver. Test both:
```bash
kubectl exec -it deployment/backend -n todo-app -- sh
nc -zv host.minikube.internal 5432
nc -zv 192.168.49.1 5432     # Minikube gateway IP — usually works reliably
```

Whichever succeeds, set it in the ConfigMap:
```bash
kubectl edit configmap todo-config -n todo-app
# DB_HOST: "192.168.49.1"   (or host.minikube.internal if that worked)

kubectl rollout restart deployment/backend -n todo-app
```

### 5. Get a free production-style domain (nip.io)

No signup needed — `nip.io` automatically resolves `<anything>.<IP>.nip.io` to `<IP>`:
```bash
curl http://169.254.169.254/latest/meta-data/public-ipv4   # get EC2 public IP
nslookup todo.<EC2_PUBLIC_IP>.nip.io                        # verify it resolves
```

Update the Ingress host:
```bash
kubectl edit ingress todo-ingress -n todo-app
# host: todo.<EC2_PUBLIC_IP>.nip.io
```

> **Important:** Do NOT use the `rewrite-target: /` annotation if your backend routes use full paths like `/api/todos`. That annotation rewrites every matched path to `/` before forwarding, which breaks Express routes (`Cannot GET /` errors). Leave it off — the Ingress should forward `/api/*` as-is.

### 6. Expose port 80 from EC2 to Minikube

Minikube's NodePort/Ingress IP (`192.168.49.2`) is internal to the EC2 host — it's not reachable from the internet directly. Forward EC2's port 80 to it with `socat`:
```bash
sudo apt-get install -y socat

sudo tee /etc/systemd/system/minikube-tunnel80.service <<EOF
[Unit]
Description=Socat tunnel port 80 for Minikube Ingress
After=network.target

[Service]
ExecStart=/usr/bin/socat TCP-LISTEN:80,fork TCP:192.168.49.2:80
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable minikube-tunnel80
sudo systemctl start minikube-tunnel80
sudo systemctl status minikube-tunnel80
```

### 7. Open port 80 in EC2 Security Group

AWS Console → EC2 → Security Groups → Inbound rules:

| Type | Protocol | Port | Source |
|---|---|---|---|
| HTTP | TCP | 80 | 0.0.0.0/0 |

### 8. Access the app

```
http://todo.<EC2_PUBLIC_IP>.nip.io
```

---

## ⚠️ EC2 Public IP Changes — What to Redo

If you stop/start the EC2 instance (without an Elastic IP), the public IP changes. After that, redo:

1. Get the new IP: `curl http://169.254.169.254/latest/meta-data/public-ipv4`
2. Update Ingress host: `kubectl edit ingress todo-ingress -n todo-app` → `todo.<NEW_IP>.nip.io`
3. Rebuild + push frontend image with the new `REACT_APP_API_URL`, then `kubectl delete pod -l app=frontend -n todo-app`
4. Check Minikube's internal IP didn't change: `minikube ip` — update the `socat` systemd service if it did
5. Re-verify `pg_hba.conf` subnet ranges still match `docker network inspect minikube`

**Best fix — avoid all of this:** allocate an **Elastic IP** in AWS (free while attached to a running instance) and associate it with your EC2 instance. The public IP then never changes across restarts.

---

## 🔌 API Endpoints

| Method | Endpoint                    | Description              |
|--------|------------------------------|---------------------------|
| GET    | /health                     | Health check              |
| GET    | /api/todos                  | List all todos            |
| GET    | /api/todos?completed=true   | Filter by completed       |
| GET    | /api/todos?priority=high    | Filter by priority        |
| GET    | /api/todos?search=keyword   | Search todos               |
| POST   | /api/todos                  | Create todo                |
| PUT    | /api/todos/:id              | Update todo                |
| PATCH  | /api/todos/:id/toggle       | Toggle completed           |
| DELETE | /api/todos/:id              | Delete todo                |
| DELETE | /api/todos/bulk/completed   | Delete all completed       |
| GET    | /api/stats                  | Get statistics             |

---

## 🔧 Environment Variables

| Variable      | Example value                         | Description            |
|----------------|----------------------------------------|-------------------------|
| PORT           | 5000                                    | Backend server port     |
| DB_HOST        | 192.168.49.1 (Minikube) / localhost     | PostgreSQL host         |
| DB_PORT        | 5432                                     | PostgreSQL port         |
| DB_NAME        | my_todo_db                              | Database name            |
| DB_USER        | my_app_user                             | DB username               |
| DB_PASSWORD    | 1234                                     | DB password (in Secret)  |
| FRONTEND_URL   | http://frontend-service                  | CORS origin                |
| REACT_APP_API_URL | http://todo.<IP>.nip.io               | Frontend build-time API URL |

---

## 🐛 Troubleshooting Reference (issues hit during setup)

| Symptom | Cause | Fix |
|---|---|---|
| `npm ci` fails: no package-lock.json | Lock file deleted | Use `npm install` instead, or generate lock file first |
| `npm install` fails: EAI_AGAIN | Docker has no DNS / no internet | Add `{"dns":["8.8.8.8","8.8.4.4"]}` to `/etc/docker/daemon.json`, or copy local `node_modules` into image instead |
| Build takes 5–8 minutes every time | No `.dockerignore`, no layer caching | Add `.dockerignore`, copy `package*.json` before source files |
| `ErrImageNeverPull` | `imagePullPolicy: Never` with a Docker Hub image | Set `imagePullPolicy: Always` and use full `username/image:tag` |
| `ErrImagePull` / `pull access denied` | Image name missing Docker Hub username | Use `2024dock/todo-backend:v1`, not `todo-backend:v1` |
| Backend stuck "DB not ready" retrying | Postgres listening only on `127.0.0.1` | Set `listen_addresses = '*'` in `postgresql.conf`, restart |
| Backend still can't connect after fixing listen_addresses | `pg_hba.conf` missing Minikube/Docker subnet | Add `host <db> <user> 192.168.49.0/24 md5` and `172.17.0.0/16` |
| `host.minikube.internal` doesn't resolve in pod | Not supported on this driver/version | Use Minikube gateway IP `192.168.49.1` instead |
| `minikube service` shows internal IP only | Minikube IP isn't reachable from internet | Forward EC2 port with `socat TCP-LISTEN:80,fork TCP:192.168.49.2:80` |
| `todo.local` doesn't open in browser | Not a real DNS name | Use `todo.<EC2_IP>.nip.io` (free wildcard DNS) or edit local `/etc/hosts` |
| UI loads but "Failed to connect to server" | Frontend was built with `REACT_APP_API_URL=localhost:5000` | Rebuild image with the correct public `REACT_APP_API_URL`, push, delete old pods |
| `curl /api/todos` returns `Cannot GET /` | Ingress `rewrite-target: /` annotation strips the path | Remove the annotation so `/api/...` reaches Express unmodified |
| Works one day, breaks after EC2 restart | Public IP changed (no Elastic IP) | Allocate an Elastic IP, or redo Ingress host + frontend rebuild with new IP |

---

## 🛑 Teardown

```bash
kubectl delete namespace todo-app
sudo systemctl stop minikube-tunnel80
minikube stop          # or: minikube delete
```

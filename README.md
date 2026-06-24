# 🚀 Full DevOps Setup — Todo App + CDC Pipeline
## EC2 + Minikube + Kubernetes + Debezium + Kafka + Elasticsearch

---

## 📋 Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [EC2 Machine Setup](#2-ec2-machine-setup)
3. [PostgreSQL Setup](#3-postgresql-setup)
4. [Todo App — Local Development](#4-todo-app--local-development)
5. [Docker Image Build & Push](#5-docker-image-build--push)
6. [Minikube & Kubernetes Setup](#6-minikube--kubernetes-setup)
7. [Todo App — K8s Deployment](#7-todo-app--k8s-deployment)
8. [Production Access — nip.io Domain](#8-production-access--nipio-domain)
9. [CDC Pipeline — Debezium + Kafka + Elasticsearch](#9-cdc-pipeline)
10. [Troubleshooting Reference](#10-troubleshooting-reference)
11. [Next Time — Full Restart Guide](#11-next-time--full-restart-guide)

---

## 1. Architecture Overview

```
Internet
    │
    ▼
EC2 (13.200.105.164) — Elastic IP (kabhi change nahi hoga)
    │
    ├── Minikube (Docker driver)
    │       ├── Nginx Ingress → http://todo.13.200.105.164.nip.io
    │       ├── frontend pods (React + Nginx)
    │       └── backend pods (Node.js/Express)
    │
    ├── PostgreSQL (native EC2 service — port 5432)
    │       └── my_todo_db → my_app_user
    │
    └── CDC Stack (Docker Compose)
            ├── Debezium (Kafka Connect) — port 8083
            ├── Kafka + Zookeeper — port 29092
            ├── Elasticsearch — port 9200
            ├── Kibana — port 5601
            └── Kafka UI — port 8080

Request Flow:
Browser → socat (port 80) → Minikube Ingress → frontend/backend pods → PostgreSQL

CDC Flow:
PostgreSQL (WAL) → Debezium → Kafka topic → Elasticsearch → Kibana
```

---

## 2. EC2 Machine Setup

### EC2 Details
- **Public IP:** 13.200.105.164 (Elastic IP — kabhi change nahi hoga)
- **OS:** Ubuntu 22.04
- **Instance:** Minimum t2.medium (2 CPU, 4GB RAM recommended)

### Security Group — Inbound Rules

| Port  | Service            | Purpose                    |
|-------|--------------------|----------------------------|
| 22    | SSH                | Remote access              |
| 80    | HTTP               | Todo App (Ingress)         |
| 8080  | Kafka UI           | Kafka browser UI           |
| 8083  | Debezium API       | Connector management       |
| 9200  | Elasticsearch      | Search API                 |
| 5601  | Kibana             | Elasticsearch UI           |
| 30080 | K8s NodePort       | Optional direct access     |

### Docker Install karo

```bash
sudo apt-get update
sudo apt-get install -y docker.io socat netcat-openbsd curl
sudo usermod -aG docker $USER
newgrp docker

# Docker DNS fix (containers internet access ke liye)
echo '{"dns": ["8.8.8.8", "8.8.4.4"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

### Minikube Install karo

```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
```

### kubectl Install karo

```bash
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl
kubectl version --client
```

---

## 3. PostgreSQL Setup

### Install karo

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### Database aur User banao

```bash
sudo -u postgres psql
```

```sql
CREATE USER my_app_user WITH PASSWORD '1234';
CREATE DATABASE my_todo_db OWNER my_app_user;
GRANT ALL PRIVILEGES ON DATABASE my_todo_db TO my_app_user;
ALTER USER my_app_user REPLICATION;   -- Debezium ke liye zaroori
\q
```

### postgresql.conf — WAL aur listen_addresses set karo

```bash
sudo nano /etc/postgresql/*/main/postgresql.conf
```

Yeh lines dhundo aur set karo:
```
listen_addresses = '*'
wal_level = logical
max_replication_slots = 5
max_wal_senders = 5
```

### pg_hba.conf — connections allow karo

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
```

End mein add karo:
```
# Minikube pods ke liye (backend → postgres)
host    my_todo_db    my_app_user    192.168.49.0/24    md5
host    my_todo_db    my_app_user    172.17.0.0/16      md5

# Debezium CDC replication ke liye
local   replication     my_app_user                     trust
host    replication     my_app_user    172.17.0.0/16    md5
host    replication     my_app_user    172.18.0.0/16    md5
host    replication     my_app_user    127.0.0.1/32     md5
```

### Restart aur verify karo

```bash
sudo systemctl restart postgresql

# WAL level check
sudo -u postgres psql -c "SHOW wal_level;"
# Expected: logical

# Interface check — 0.0.0.0 dikhna chahiye, 127.0.0.1 nahi
sudo ss -tlnp | grep 5432
```

### Debezium ke liye extra setup (CDC section se pehle karo)

```bash
# todos table REPLICA IDENTITY set karo
sudo -u postgres psql -d my_todo_db -c "ALTER TABLE todos REPLICA IDENTITY FULL;"

# Publication manually banao (superuser se)
sudo -u postgres psql -d my_todo_db -c "CREATE PUBLICATION debezium_pub FOR TABLE public.todos;"

# Verify
sudo -u postgres psql -d my_todo_db -c "\dRp+"
```

---

## 4. Todo App — Local Development

### .env file (backend)

```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=my_todo_db
DB_USER=my_app_user
DB_PASSWORD=1234
FRONTEND_URL=http://localhost:3000
```

### Direct run (Node.js)

```bash
# Backend
cd todo-app/backend
npm install
npm start          # http://localhost:5000

# Frontend (alag terminal)
cd todo-app/frontend
REACT_APP_API_URL=http://localhost:5000 npm install
REACT_APP_API_URL=http://localhost:5000 npm start
# http://localhost:3000
```

### Docker Compose (sabse easy)

```bash
cd todo-app
docker-compose up --build
# Frontend: http://localhost:3000
# Backend:  http://localhost:5000
```

---

## 5. Docker Image Build & Push

> **Important:** `node_modules` locally install karo pehle. EC2 pe Docker ke andar `npm install` nahi karte — DNS timeout issue hota hai. Dockerfiles `COPY node_modules/` use karti hain.

### Backend image

```bash
cd todo-app/backend
npm install    # node_modules generate karo locally

docker build -t 2024dock/todo-backend:v1 .
docker push 2024dock/todo-backend:v1
```

### Frontend image

```bash
cd todo-app/frontend
npm install    # node_modules generate karo locally

# REACT_APP_API_URL build time pe bake hota hai
docker build \
  --build-arg REACT_APP_API_URL=http://todo.13.200.105.164.nip.io \
  -t 2024dock/todo-frontend:v1 .
docker push 2024dock/todo-frontend:v1
```

### Verify image mein sahi URL bake hua

```bash
docker run --rm 2024dock/todo-frontend:v1 \
  grep -o "13.200.105.164" /usr/share/nginx/html/static/js/main.*.js
# Output: 13.200.105.164
```

---

## 6. Minikube & Kubernetes Setup

### Minikube start karo

```bash
minikube start --driver=docker --cpus=2 --memory=3g
minikube addons enable ingress
minikube addons enable metrics-server

# Verify
minikube status
minikube ip    # usually 192.168.49.2
kubectl get nodes
```

### Port 80 forward karo — permanent systemd service

```bash
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

---

## 7. Todo App — K8s Deployment

### 00-namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: todo-app
```

### 01-configmap-secret.yaml

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: todo-config
  namespace: todo-app
data:
  DB_HOST: "192.168.49.1"      # Minikube gateway → EC2 native postgres
  DB_PORT: "5432"
  DB_NAME: "my_todo_db"
  DB_USER: "my_app_user"
  PORT: "5000"
  FRONTEND_URL: "http://frontend-service"

---
apiVersion: v1
kind: Secret
metadata:
  name: todo-secret
  namespace: todo-app
type: Opaque
data:
  DB_PASSWORD: MTIzNA==    # echo -n '1234' | base64
```

### 03-backend.yaml

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: todo-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: 2024dock/todo-backend:v1
          imagePullPolicy: Always
          ports:
            - containerPort: 5000
          env:
            - name: PORT
              valueFrom:
                configMapKeyRef:
                  name: todo-config
                  key: PORT
            - name: DB_HOST
              valueFrom:
                configMapKeyRef:
                  name: todo-config
                  key: DB_HOST
            - name: DB_PORT
              valueFrom:
                configMapKeyRef:
                  name: todo-config
                  key: DB_PORT
            - name: DB_NAME
              valueFrom:
                configMapKeyRef:
                  name: todo-config
                  key: DB_NAME
            - name: DB_USER
              valueFrom:
                configMapKeyRef:
                  name: todo-config
                  key: DB_USER
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: todo-secret
                  key: DB_PASSWORD
            - name: FRONTEND_URL
              valueFrom:
                configMapKeyRef:
                  name: todo-config
                  key: FRONTEND_URL
          livenessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 30
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 10
            periodSeconds: 5
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "300m"

---
apiVersion: v1
kind: Service
metadata:
  name: backend-service
  namespace: todo-app
spec:
  selector:
    app: backend
  ports:
    - port: 5000
      targetPort: 5000
  type: ClusterIP
```

### 04-frontend.yaml

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: todo-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: 2024dock/todo-frontend:v1
          imagePullPolicy: Always
          ports:
            - containerPort: 80
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "200m"

---
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  namespace: todo-app
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
```

### 05-ingress.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: todo-ingress
  namespace: todo-app
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
    # IMPORTANT: rewrite-target: / mat lagao
    # Isse /api/todos → / ban jaata hai → Express mein "Cannot GET /" error
spec:
  ingressClassName: nginx
  rules:
    - host: todo.13.200.105.164.nip.io
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: backend-service
                port:
                  number: 5000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-service
                port:
                  number: 80
```

### 06-hpa.yaml

```yaml
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
  namespace: todo-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend
  minReplicas: 2
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: frontend-hpa
  namespace: todo-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: frontend
  minReplicas: 2
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### Deploy karo

```bash
cd todo-app/k8s
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-configmap-secret.yaml
kubectl apply -f 03-backend.yaml
kubectl apply -f 04-frontend.yaml
kubectl apply -f 05-ingress.yaml
kubectl apply -f 06-hpa.yaml

# Watch karo
kubectl get pods -n todo-app -w
```

### Verify karo

```bash
# Logs check
kubectl logs -f deployment/backend -n todo-app
# "Database initialized" aur "Backend running on port 5000" dikhna chahiye

# API test
curl http://todo.13.200.105.164.nip.io/api/todos
# JSON response aana chahiye

# Ingress check
kubectl get ingress -n todo-app
```

---

## 8. Production Access — nip.io Domain

### Kaise kaam karta hai

```
Browser: http://todo.13.200.105.164.nip.io
         │
         ▼ nip.io DNS → 13.200.105.164
         │
    EC2 port 80
         │
         ▼ socat tunnel
         │
    Minikube 192.168.49.2:80
         │
         ▼ Nginx Ingress
         │
    ├── /api → backend-service:5000
    └── /    → frontend-service:80
```

### Todo App URL

```
http://todo.13.200.105.164.nip.io
```

---

## 9. CDC Pipeline

### Architecture

```
PostgreSQL (my_todo_db)
    │  WAL (Write-Ahead Log)
    ▼
Debezium (Kafka Connect)  — captures INSERT/UPDATE/DELETE
    │
    ▼
Kafka topic: todo.public.todos
    │
    ▼
Elasticsearch index: todos
    │
    ▼
Kibana (visualize & search)
```

### Stack start karo

```bash
cd todo-app/cdc-stack
docker-compose up -d
docker-compose ps
# Sabka STATUS: healthy hona chahiye
```

### Elasticsearch index banao

```bash
chmod +x setup-elasticsearch.sh
./setup-elasticsearch.sh
# Output: {"acknowledged":true}
```

### Debezium connector register karo

```bash
chmod +x register-connector.sh
./register-connector.sh

# Verify — dono RUNNING hone chahiye
curl -s http://localhost:8083/connectors/postgres-connector/status | python3 -m json.tool
```

Expected output:
```json
{
  "connector": { "state": "RUNNING" },
  "tasks": [{ "state": "RUNNING" }]
}
```

### Live CDC test karo

```bash
# Terminal 1 — Kafka pe live messages dekho
docker exec -it cdc-kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic todo.public.todos \
  --from-beginning

# Terminal 2 — PostgreSQL mein change karo
sudo -u postgres psql -d my_todo_db -c "
INSERT INTO todos (title, description, priority)
VALUES ('CDC Test', 'Live change capture', 'high');
"

# Terminal 1 pe event dikhega automatically!

# Elasticsearch mein data aaya?
curl -s "http://localhost:9200/todos/_search?pretty"
```

### Browser UIs

| Service | URL |
|---|---|
| Todo App | http://todo.13.200.105.164.nip.io |
| Kafka UI | http://13.200.105.164:8080 |
| Kibana | http://13.200.105.164:5601 |
| Elasticsearch | http://13.200.105.164:9200 |
| Debezium API | http://13.200.105.164:8083 |

---

## 10. Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| `npm ci` fails: no package-lock.json | Lock file delete ho gaya | `npm install` use karo |
| Docker build `EAI_AGAIN` | Docker DNS issue | `/etc/docker/daemon.json` mein `{"dns":["8.8.8.8","8.8.4.4"]}` add karo |
| `ErrImageNeverPull` | `imagePullPolicy: Never` with Docker Hub image | `imagePullPolicy: Always` karo |
| `ErrImagePull` / pull access denied | Image name mein username missing | `2024dock/todo-backend:v1` use karo |
| Backend "DB not ready" retrying | Postgres sirf `127.0.0.1` pe listen kar raha | `listen_addresses = '*'` postgresql.conf mein |
| Backend pods still failing after listen fix | pg_hba.conf mein subnet missing | `192.168.49.0/24` aur `172.17.0.0/16` add karo |
| `host.minikube.internal` resolve nahi | Docker driver support | `DB_HOST: 192.168.49.1` use karo |
| UI loads lekin "Failed to connect to server" | Frontend wrong API URL se build hua | Rebuild: `--build-arg REACT_APP_API_URL=http://todo.13.200.105.164.nip.io` |
| `Cannot GET /` API call pe | `rewrite-target: /` annotation | Ingress se yeh annotation hatao |
| nip.io URL nahi khulta | socat tunnel nahi chal raha | `sudo systemctl start minikube-tunnel80` |
| Debezium: `permission denied to start WAL sender` | User ko REPLICATION permission nahi | `ALTER USER my_app_user REPLICATION;` |
| Debezium: `must be superuser to create publication` | User superuser nahi | `CREATE PUBLICATION debezium_pub FOR TABLE public.todos;` manually banao |
| Debezium task FAILED restart ke baad | Purana replication slot exist karta | `SELECT pg_drop_replication_slot('debezium_slot');` phir re-register |
| Elasticsearch mein data nahi | Debezium task FAILED | Status check: `curl localhost:8083/connectors/postgres-connector/status` |

---

## 11. Next Time — Full Restart Guide

> EC2 restart ke baad yeh order mein karo (Elastic IP hai toh IP same rahega):

### Step 1: PostgreSQL verify karo

```bash
sudo systemctl status postgresql
sudo ss -tlnp | grep 5432
# 0.0.0.0:5432 dikhna chahiye
```

### Step 2: Minikube start karo

```bash
minikube start --driver=docker
minikube status
minikube ip    # 192.168.49.2 confirm karo
```

### Step 3: socat tunnel start karo

```bash
sudo systemctl start minikube-tunnel80
sudo systemctl status minikube-tunnel80
```

### Step 4: K8s pods check karo

```bash
kubectl get pods -n todo-app
# Sabka 1/1 Running hona chahiye

# Agar nahi hain
cd todo-app/k8s
kubectl apply -f .
kubectl get pods -n todo-app -w
```

### Step 5: Todo App verify karo

```bash
curl http://todo.13.200.105.164.nip.io/api/todos
# JSON response aana chahiye

# Browser
# http://todo.13.200.105.164.nip.io
```

### Step 6: CDC stack start karo

```bash
cd todo-app/cdc-stack
docker-compose up -d
docker-compose ps
# Sabka healthy hona chahiye
```

### Step 7: Debezium connector check karo

```bash
curl -s http://localhost:8083/connectors/postgres-connector/status | python3 -m json.tool
```

Agar task FAILED hai:
```bash
# Purana slot delete karo
sudo -u postgres psql -d my_todo_db -c \
  "SELECT pg_drop_replication_slot('debezium_slot');" 2>/dev/null || echo "slot nahi tha"

# Delete aur re-register
curl -X DELETE http://localhost:8083/connectors/postgres-connector
sleep 5
cd todo-app/cdc-stack
./register-connector.sh
```

### Step 8: Full verify

```bash
# Kafka topics
docker exec -it cdc-kafka kafka-topics --list --bootstrap-server localhost:9092
# todo.public.todos dikhna chahiye

# Elasticsearch
curl -s "http://localhost:9200/todos/_search?pretty"

# Live CDC test
sudo -u postgres psql -d my_todo_db -c "
INSERT INTO todos (title, description, priority)
VALUES ('Restart Test', 'Sab kaam kar raha hai', 'high');
"
curl -s "http://localhost:9200/todos/_search?pretty" | grep "Restart Test"
```

### Sab sahi hai to yeh URLs kaam karenge

| URL | Service |
|---|---|
| http://todo.13.200.105.164.nip.io | Todo App |
| http://13.200.105.164:8080 | Kafka UI |
| http://13.200.105.164:5601 | Kibana |
| http://13.200.105.164:9200 | Elasticsearch |
| http://13.200.105.164:8083 | Debezium API |

---

## 📁 Complete Folder Structure

```
todo-app/
├── backend/
│   ├── src/index.js
│   ├── Dockerfile          # COPY node_modules (local se)
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.js          # const API = process.env.REACT_APP_API_URL || ''
│   │   └── index.js
│   ├── Dockerfile          # multi-stage: Node build → Nginx
│   ├── nginx.conf
│   └── package.json
├── k8s/
│   ├── 00-namespace.yaml
│   ├── 01-configmap-secret.yaml   # DB_HOST: 192.168.49.1
│   ├── 03-backend.yaml            # ClusterIP service
│   ├── 04-frontend.yaml           # ClusterIP service
│   ├── 05-ingress.yaml            # nip.io domain, NO rewrite-target
│   └── 06-hpa.yaml
├── cdc-stack/
│   ├── docker-compose.yml         # Zookeeper, Kafka, Debezium, ES, Kibana
│   ├── debezium-connector.json    # host.docker.internal:5432
│   ├── register-connector.sh
│   └── setup-elasticsearch.sh
└── docker-compose.yml             # Todo app local dev only
```
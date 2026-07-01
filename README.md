# 🚀 Complete DevOps Setup Guide
## Todo App + CDC Pipeline + Monitoring on EC2 + Minikube + Kubernetes + FluxCD

---

## 📋 Table of Contents

1. [My Setup Details](#1-my-setup-details)
2. [Architecture](#2-architecture)
3. [EC2 Machine Setup](#3-ec2-machine-setup)
4. [PostgreSQL Setup](#4-postgresql-setup)
5. [Todo App — Local Run](#5-todo-app--local-run)
6. [Docker Image Build & Push](#6-docker-image-build--push)
7. [Minikube Setup](#7-minikube-setup)
8. [Flux CD Setup — GitOps](#8-flux-cd-setup--gitops)
9. [Kubernetes Deployment via Flux](#9-kubernetes-deployment-via-flux)
10. [Production Domain Setup](#10-production-domain-setup)
11. [Monitoring — Prometheus + Grafana](#11-monitoring--prometheus--grafana)
12. [CDC Pipeline Setup](#12-cdc-pipeline-setup)
13. [Permanent Tunnels — systemd](#13-permanent-tunnels--systemd)
14. [Restart Guide — Next Time](#14-restart-guide--next-time)
15. [All K8s Files Content](#15-all-k8s-files-content)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. My Setup Details

| Item | Value |
|---|---|
| EC2 Public IP (Elastic) | 13.200.105.164 |
| EC2 Instance Type | m7i-flex.large (8GB RAM, 2 vCPU) |
| OS | Ubuntu 22.04 |
| Docker Hub Username | 2024dock |
| GitHub Repo | https://github.com/Raju7061/todo-app.git |
| GitHub Branch | main |
| DB Name | my_todo_db |
| DB User | my_app_user |
| DB Password | 1234 |
| Todo App URL | http://todo.13.200.105.164.nip.io |
| Prometheus URL | http://13.200.105.164:30090 |
| Grafana URL | http://13.200.105.164:32000 |
| Grafana Login | admin / admin123 |
| Kafka UI | http://13.200.105.164:8080 |
| Kibana | http://13.200.105.164:5601 |
| Elasticsearch | http://13.200.105.164:9200 |
| Debezium API | http://13.200.105.164:8083 |

---

## 2. Architecture

```
Internet
    │
    ▼
EC2 (13.200.105.164) — Elastic IP (kabhi change nahi hoga)
    │
    ├── Minikube (Docker driver) — 192.168.49.2
    │       ├── Nginx Ingress (port 80)
    │       │       ├── /api  → backend pods (Node.js)
    │       │       └── /     → frontend pods (React+Nginx)
    │       ├── Monitoring namespace
    │       │       ├── Prometheus (port 30090)
    │       │       ├── Grafana (port 32000)
    │       │       ├── Node Exporter
    │       │       ├── Kube State Metrics
    │       │       └── PostgreSQL Exporter
    │       └── HPA (auto scaling)
    │
    ├── PostgreSQL (native EC2 — port 5432)
    │       └── my_todo_db
    │
    └── CDC Stack (Docker Compose)
            ├── Zookeeper (port 2181)
            ├── Kafka (port 29092)
            ├── Debezium/Kafka Connect (port 8083)
            ├── Logstash (Kafka → Elasticsearch)
            ├── Elasticsearch (port 9200)
            ├── Kibana (port 5601)
            └── Kafka UI (port 8080)

GitOps Flow:
Git Push → FluxCD detects → kubectl apply → Pods update

CDC Flow:
PostgreSQL (WAL) → Debezium → Kafka → Logstash → Elasticsearch → Kibana

Request Flow:
Browser → EC2:80 → socat → Minikube Ingress → pods → PostgreSQL
```

---

## 3. EC2 Machine Setup

### EC2 Security Group — Inbound Rules

| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | HTTP (Todo App) |
| 8080 | Kafka UI |
| 8083 | Debezium API |
| 9200 | Elasticsearch |
| 5601 | Kibana |
| 30090 | Prometheus |
| 32000 | Grafana |

### Install Docker

```bash
sudo apt-get update
sudo apt-get install -y docker.io socat netcat-openbsd curl unzip git
sudo usermod -aG docker $USER
newgrp docker

# Docker DNS fix
echo '{"dns": ["8.8.8.8", "8.8.4.4"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
sudo systemctl enable docker
```

### Install Minikube

```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
rm minikube-linux-amd64
minikube version
```

### Install kubectl

```bash
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl
rm kubectl
kubectl version --client
```

### Install Flux CLI

```bash
curl -s https://fluxcd.io/install.sh | sudo bash
flux version
# Expected: flux version 2.8.8
```

---

## 4. PostgreSQL Setup

### Install

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### Create Database and User

```bash
sudo -u postgres psql
```

```sql
CREATE USER my_app_user WITH PASSWORD '1234';
CREATE DATABASE my_todo_db OWNER my_app_user;
GRANT ALL PRIVILEGES ON DATABASE my_todo_db TO my_app_user;
ALTER USER my_app_user REPLICATION;
\q
```

### postgresql.conf — WAL + Listen Address

```bash
sudo nano /etc/postgresql/*/main/postgresql.conf
```

Set:
```
listen_addresses = '*'
wal_level = logical
max_replication_slots = 5
max_wal_senders = 5
```

### pg_hba.conf — Allow connections

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
```

Add at end:
```
# Minikube pods
host    my_todo_db    my_app_user    192.168.49.0/24    md5
host    my_todo_db    my_app_user    172.17.0.0/16      md5

# Debezium replication
local   replication     my_app_user                     trust
host    replication     my_app_user    172.17.0.0/16    md5
host    replication     my_app_user    172.18.0.0/16    md5
host    replication     my_app_user    127.0.0.1/32     md5
```

### Restart and Verify

```bash
sudo systemctl restart postgresql

# WAL level check
sudo -u postgres psql -c "SHOW wal_level;"
# Expected: logical

# Interface check
sudo ss -tlnp | grep 5432
# Expected: 0.0.0.0:5432
```

### Debezium CDC Setup (one-time)

```bash
# REPLICA IDENTITY
sudo -u postgres psql -d my_todo_db -c "ALTER TABLE todos REPLICA IDENTITY FULL;"

# Publication
sudo -u postgres psql -d my_todo_db -c "CREATE PUBLICATION debezium_pub FOR TABLE public.todos;"

# Verify
sudo -u postgres psql -d my_todo_db -c "\dRp+"
```

---

## 5. Todo App — Local Run

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

### Run directly

```bash
# Backend
cd todo-app/backend
npm install
npm start    # http://localhost:5000

# Frontend (new terminal)
cd todo-app/frontend
REACT_APP_API_URL=http://localhost:5000 npm install
REACT_APP_API_URL=http://localhost:5000 npm start
```

### Docker Compose (easiest)

```bash
cd todo-app
docker-compose up --build
```

---

## 6. Docker Image Build & Push

> **IMPORTANT:** `node_modules` locally install karo pehle. EC2 mein Docker ke andar `npm install` karne se DNS timeout hota hai.

### Backend

```bash
cd todo-app/backend
npm install
docker build -t 2024dock/todo-backend:v1 .
docker push 2024dock/todo-backend:v1
```

### Frontend

```bash
cd todo-app/frontend
npm install

docker build \
  --build-arg REACT_APP_API_URL=http://todo.13.200.105.164.nip.io \
  -t 2024dock/todo-frontend:v1 .
docker push 2024dock/todo-frontend:v1
```

### Verify

```bash
docker run --rm 2024dock/todo-frontend:v1 \
  grep -o "13.200.105.164" /usr/share/nginx/html/static/js/main.*.js
```

---

## 7. Minikube Setup

### Start Minikube

```bash
minikube start --driver=docker --cpus=2 --memory=6g
minikube addons enable ingress
minikube addons enable metrics-server

# Verify
minikube status
minikube ip    # 192.168.49.2
kubectl get nodes
```

---

## 8. Flux CD Setup — GitOps

### GitHub Personal Access Token banao

```
GitHub → Settings → Developer Settings
→ Personal Access Tokens → Tokens (classic)
→ Generate new token
→ Scopes: repo (full), read:org
→ Copy token
```

### Flux Bootstrap karo (GitHub)

```bash
export GITHUB_TOKEN=<aapka_github_token>
export GITHUB_USER=Raju7061

flux bootstrap github \
  --owner=$GITHUB_USER \
  --repository=todo-app \
  --branch=main \
  --path=clusters/my-cluster \
  --personal \
  --token-auth
```

Yeh command:
- Flux components install karta hai cluster mein
- `clusters/my-cluster/flux-system/` folder create karta hai
- GitHub repo se sync shuru ho jaata hai

### Verify Flux installation

```bash
flux check
flux get sources git
flux get kustomizations
kubectl get pods -n flux-system
```

### GitRepository file (auto-created by bootstrap)

`clusters/my-cluster/todo-app-source.yaml`:
```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: todo-app-source
  namespace: flux-system
spec:
  interval: 1m0s
  url: https://github.com/Raju7061/todo-app.git
  ref:
    branch: main
```

### Kustomization file

`clusters/my-cluster/todo-app-kustomization.yaml`:
```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: todo-app-deploy
  namespace: flux-system
spec:
  interval: 2m0s
  path: "./k8s"
  prune: true
  sourceRef:
    kind: GitRepository
    name: todo-app-source
```

> **Note:** `targetNamespace` mat likho — har YAML file mein explicitly `namespace:` likho.

### Monitoring Kustomization

`clusters/my-cluster/monitoring-kustomization.yaml`:
```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: monitoring-deploy
  namespace: flux-system
spec:
  interval: 2m0s
  path: "./k8s/monitoring"
  prune: true
  sourceRef:
    kind: GitRepository
    name: todo-app-source
```

### Git push karo

```bash
cd ~/todo-app
git add .
git commit -m "Add Flux kustomizations"
git push

# Flux sync force karo
flux reconcile source git todo-app-source
flux reconcile kustomization todo-app-deploy
flux reconcile kustomization monitoring-deploy

# Status
flux get kustomizations
```

### Flux daily use commands

```bash
# Sync force karo (git push ke baad)
flux reconcile source git todo-app-source

# Status dekho
flux get kustomizations
flux get sources git

# Logs dekho
flux logs --kind=Kustomization --name=todo-app-deploy -n flux-system
flux logs --kind=Kustomization --name=monitoring-deploy -n flux-system

# Kisi issue ko debug karo
kubectl describe kustomization todo-app-deploy -n flux-system
```

---

## 9. Kubernetes Deployment via Flux

### Folder Structure

```
todo-app/
├── clusters/
│   └── my-cluster/
│       ├── flux-system/
│       │   ├── gotk-components.yaml
│       │   ├── gotk-sync.yaml
│       │   └── kustomization.yaml
│       ├── todo-app-source.yaml
│       ├── todo-app-kustomization.yaml
│       └── monitoring-kustomization.yaml
└── k8s/
    ├── kustomization.yaml           ← todo app files list
    ├── namespace.yaml               ← namespace: raju
    ├── configmap.yaml
    ├── sealed-secrets.yaml
    ├── backend.yaml
    ├── frontend.yaml
    ├── ingress.yaml
    ├── hpa.yaml
    └── monitoring/
        ├── kustomization.yaml       ← monitoring files list
        ├── namespace.yaml           ← namespace: monitoring
        ├── prometheus-rbc.yaml
        ├── prometheus-cm.yaml
        ├── prometheus.yaml
        ├── node-exporter.yaml
        ├── postgres-exporter.yaml
        ├── grafana.yaml
        └── kube-state.yaml
```

### k8s/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - configmap.yaml
  - sealed-secrets.yaml
  - backend.yaml
  - frontend.yaml
  - ingress.yaml
  - hpa.yaml
```

### k8s/namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: raju
```

### k8s/monitoring/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - prometheus-rbc.yaml
  - prometheus-cm.yaml
  - prometheus.yaml
  - node-exporter.yaml
  - postgres-exporter.yaml
  - grafana.yaml
  - kube-state.yaml
```

### k8s/monitoring/namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: monitoring
```

### Deploy flow (GitOps)

```bash
# Koi bhi change karo
nano ~/todo-app/k8s/backend.yaml

# Git push karo — Flux automatically apply karega
git add .
git commit -m "Update backend image"
git push

# Flux 1-2 min mein sync karega — ya force karo
flux reconcile source git todo-app-source
```

---

## 10. Production Domain Setup

### nip.io kaise kaam karta hai

```
http://todo.13.200.105.164.nip.io
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
    ├── /api → backend-service:5000
    └── /    → frontend-service:80
```

### Verify

```bash
nslookup todo.13.200.105.164.nip.io
curl http://todo.13.200.105.164.nip.io/api/todos
```

---

## 11. Monitoring — Prometheus + Grafana

### Deploy (Flux se automatic hoga)

```bash
git add .
git commit -m "Add monitoring stack"
git push
flux reconcile source git todo-app-source
flux reconcile kustomization monitoring-deploy

# Pods check
kubectl get pods -n monitoring -w
```

### Kya monitor hoga

| Component | Kya dekh sakte hain |
|---|---|
| Node Exporter | EC2 CPU, RAM, Disk, Network |
| Kube State Metrics | Pod status, Deployment, HPA |
| cAdvisor | Container CPU/RAM usage |
| PostgreSQL Exporter | DB connections, queries, locks |
| Prometheus | Sab metrics store |
| Grafana | Visual dashboards |

### Grafana Dashboards Import karo

```
http://13.200.105.164:32000
Login: admin / admin123

Left sidebar → Dashboards → Import
```

| Dashboard | ID | Kya dikhega |
|---|---|---|
| K8s Cluster Overview | `315` | Nodes, Pods, CPU, RAM |
| Node Exporter Full | `1860` | EC2 system metrics |
| PostgreSQL Database | `9628` | DB queries, connections |
| K8s Pod Monitoring | `6417` | Per-pod metrics |
| Kubernetes Deployments | `8588` | Deployment status |

### Prometheus Queries (useful)

```
# Pod CPU usage
rate(container_cpu_usage_seconds_total{namespace="raju"}[5m])

# Pod Memory usage
container_memory_usage_bytes{namespace="raju"}

# DB connections
pg_stat_activity_count

# Pod restart count
kube_pod_container_status_restarts_total{namespace="raju"}

# Node CPU
100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
```

---

## 12. CDC Pipeline Setup

### Folder Structure

```
todo-app/cdc-stack/
├── docker-compose.yml
├── logstash.conf
├── debezium-connector.json
├── register-connector.sh
├── setup-elasticsearch.sh
└── restart-cdc.sh
```

### Start Stack

```bash
cd ~/todo-app/cdc-stack
docker-compose up -d
sleep 60
docker-compose ps    # sabka healthy hona chahiye
```

### Setup

```bash
chmod +x *.sh

# Elasticsearch index banao
./setup-elasticsearch.sh

# Debezium connector register karo
./register-connector.sh

# Verify
curl -s http://localhost:8083/connectors/postgres-connector/status | python3 -m json.tool
```

### Live CDC Test

```bash
# Insert karo
sudo -u postgres psql -d my_todo_db -c "
INSERT INTO todos (title, description, priority)
VALUES ('CDC Test', 'Pipeline test', 'high');
"

sleep 15

# Elasticsearch mein check karo
curl -s "http://localhost:9200/todos/_count?pretty"
# count > 0 hona chahiye

# Kafka topic check
docker exec -it cdc-kafka kafka-topics --list --bootstrap-server localhost:9092
# todo.public.todos dikhna chahiye
```

### Kibana Setup

```
1. http://13.200.105.164:5601
2. Stack Management → Data Views → Create data view
3. Name: todos, Index pattern: todos*, Timestamp: created_at
4. Discover → todos select karo → Time range: Last 1 year
```

---

## 13. Permanent Tunnels — systemd

> Production mein socat nahi hota — yeh sirf Minikube/learning setup ke liye hai.

### Port 80 — Todo App

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
```

### Port 30090 + 32000 — Monitoring

```bash
sudo tee /etc/systemd/system/minikube-monitoring.service <<EOF
[Unit]
Description=Socat tunnels for Monitoring ports
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash -c '\
  socat TCP-LISTEN:30090,fork TCP:192.168.49.2:30090 & \
  socat TCP-LISTEN:32000,fork TCP:192.168.49.2:32000 &'
ExecStop=/usr/bin/pkill -f "socat TCP-LISTEN"
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable minikube-monitoring
sudo systemctl start minikube-monitoring
```

### All tunnels verify karo

```bash
sudo systemctl status minikube-tunnel80
sudo systemctl status minikube-monitoring
sudo ss -tlnp | grep -E ":80|:30090|:32000"
```

---

## 14. Restart Guide — Next Time

> EC2 restart ke baad yeh order mein karo:

### Step 1: PostgreSQL verify

```bash
sudo systemctl status postgresql
sudo ss -tlnp | grep 5432
# 0.0.0.0:5432 dikhna chahiye

# Agar band hai
sudo systemctl start postgresql
```

### Step 2: Minikube start

```bash
minikube start --driver=docker
minikube status
minikube ip    # 192.168.49.2 confirm karo
```

### Step 3: Tunnels start karo

```bash
sudo systemctl start minikube-tunnel80
sudo systemctl start minikube-monitoring
sudo systemctl status minikube-tunnel80 minikube-monitoring
```

### Step 4: Flux verify karo

```bash
flux get kustomizations
# todo-app-deploy aur monitoring-deploy dono Ready hone chahiye

# Agar nahi hain
flux reconcile source git todo-app-source
flux reconcile kustomization todo-app-deploy
flux reconcile kustomization monitoring-deploy
```

### Step 5: K8s pods check

```bash
kubectl get pods -n raju
kubectl get pods -n monitoring
# Sabka Running hona chahiye
```

### Step 6: Todo App verify

```bash
curl http://todo.13.200.105.164.nip.io/api/todos
# JSON response aana chahiye
```

### Step 7: CDC stack start

```bash
cd ~/todo-app/cdc-stack
docker-compose up -d
sleep 60
docker-compose ps

# Debezium connector check
curl -s http://localhost:8083/connectors/postgres-connector/status | python3 -m json.tool
```

### Step 8: Agar Debezium FAILED hai

```bash
cd ~/todo-app/cdc-stack

# Slot delete karo
sudo -u postgres psql -d my_todo_db -c \
  "SELECT pg_drop_replication_slot('debezium_slot');" 2>/dev/null || echo "ok"

# Re-register
curl -X DELETE http://localhost:8083/connectors/postgres-connector 2>/dev/null
sleep 5
./register-connector.sh
```

### Step 9: Full verify

```bash
echo "=== Todo App ===" && curl -s http://todo.13.200.105.164.nip.io/api/todos | head -c 50
echo "=== Prometheus ===" && curl -s http://localhost:30090/-/healthy
echo "=== Grafana ===" && curl -s http://localhost:32000/api/health
echo "=== Elasticsearch ===" && curl -s http://localhost:9200/_cluster/health?pretty
echo "=== Kafka ===" && docker exec cdc-kafka kafka-topics --list --bootstrap-server localhost:9092
```

### All URLs

| URL | Service |
|---|---|
| http://todo.13.200.105.164.nip.io | Todo App |
| http://13.200.105.164:30090 | Prometheus |
| http://13.200.105.164:32000 | Grafana (admin/admin123) |
| http://13.200.105.164:8080 | Kafka UI |
| http://13.200.105.164:5601 | Kibana |
| http://13.200.105.164:9200 | Elasticsearch |
| http://13.200.105.164:8083 | Debezium API |

---

## 15. All K8s Files Content

### k8s/configmap.yaml

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: todo-config
  namespace: raju
data:
  DB_HOST: "192.168.49.1"
  DB_PORT: "5432"
  DB_NAME: "my_todo_db"
  DB_USER: "my_app_user"
  PORT: "5000"
  FRONTEND_URL: "http://frontend-service"
```

### k8s/backend.yaml

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: raju
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
  namespace: raju
spec:
  selector:
    app: backend
  ports:
    - port: 5000
      targetPort: 5000
  type: ClusterIP
```

### k8s/frontend.yaml

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: raju
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
  namespace: raju
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
```

### k8s/ingress.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: todo-ingress
  namespace: raju
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
    # IMPORTANT: rewrite-target: / mat lagao — /api path break hota hai
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

### k8s/hpa.yaml

```yaml
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
  namespace: raju
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
  namespace: raju
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

---

## 16. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm ci` fails | No package-lock.json | `npm install` use karo |
| Docker build `EAI_AGAIN` | Docker DNS issue | `/etc/docker/daemon.json` mein `{"dns":["8.8.8.8","8.8.4.4"]}` |
| `ErrImageNeverPull` | Wrong imagePullPolicy | `imagePullPolicy: Always` + full `username/image:tag` |
| Backend "DB not ready" | Postgres 127.0.0.1 pe | `listen_addresses = '*'` postgresql.conf mein |
| `host.minikube.internal` resolve nahi | Docker driver | `DB_HOST: 192.168.49.1` use karo |
| UI "Failed to connect to server" | Wrong API URL in image | Rebuild frontend with correct `REACT_APP_API_URL` |
| `Cannot GET /` API pe | `rewrite-target: /` annotation | Ingress se yeh annotation hatao |
| nip.io URL nahi khulta | socat tunnel band | `sudo systemctl start minikube-tunnel80` |
| Minikube start fails | RAM kam | `minikube start --memory=6g` |
| Flux sync nahi ho raha | Git credentials issue | `flux reconcile source git todo-app-source` |
| Flux kustomization failed | YAML error ya namespace wrong | `flux logs --kind=Kustomization --name=todo-app-deploy` |
| Monitoring pods pending | Namespace nahi bana | `k8s/monitoring/namespace.yaml` add karo |
| Grafana nahi khulta | socat monitoring band | `sudo systemctl start minikube-monitoring` |
| Debezium WAL permission | REPLICATION missing | `ALTER USER my_app_user REPLICATION;` |
| Debezium publication error | Superuser chahiye | `CREATE PUBLICATION debezium_pub FOR TABLE public.todos;` manually |
| Debezium FAILED restart ke baad | Replication slot exists | `SELECT pg_drop_replication_slot('debezium_slot');` |
| Elasticsearch count = 0 | Logstash nahi chala | `docker logs cdc-logstash --tail 20` |
| Kibana "No available fields" | Time range galat | Time range "Last 1 year" set karo |

---

## 📁 Complete Project Structure

```
todo-app/
├── backend/
│   ├── src/index.js
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── public/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── clusters/
│   └── my-cluster/
│       ├── flux-system/
│       │   ├── gotk-components.yaml
│       │   ├── gotk-sync.yaml
│       │   └── kustomization.yaml
│       ├── todo-app-source.yaml
│       ├── todo-app-kustomization.yaml
│       └── monitoring-kustomization.yaml
├── k8s/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── sealed-secrets.yaml
│   ├── backend.yaml
│   ├── frontend.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   └── monitoring/
│       ├── kustomization.yaml
│       ├── namespace.yaml
│       ├── prometheus-rbc.yaml
│       ├── prometheus-cm.yaml
│       ├── prometheus.yaml
│       ├── node-exporter.yaml
│       ├── postgres-exporter.yaml
│       ├── grafana.yaml
│       └── kube-state.yaml
├── cdc-stack/
│   ├── docker-compose.yml
│   ├── logstash.conf
│   ├── debezium-connector.json
│   ├── register-connector.sh
│   ├── setup-elasticsearch.sh
│   └── restart-cdc.sh
└── docker-compose.yml
```

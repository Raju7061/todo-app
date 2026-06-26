# 🚀 Complete DevOps Setup Guide
## Todo App + CDC Pipeline on EC2 + Minikube + Kubernetes

---

## 📋 Table of Contents

1. [My Setup Details](#1-my-setup-details)
2. [Architecture](#2-architecture)
3. [EC2 Machine Setup](#3-ec2-machine-setup)
4. [PostgreSQL Setup](#4-postgresql-setup)
5. [Todo App — Local Run](#5-todo-app--local-run)
6. [Docker Image Build & Push](#6-docker-image-build--push)
7. [Minikube Setup](#7-minikube-setup)
8. [Kubernetes Deployment](#8-kubernetes-deployment)
9. [Production Domain Setup](#9-production-domain-setup)
10. [CDC Pipeline Setup](#10-cdc-pipeline-setup)
11. [Restart Guide — Next Time](#11-restart-guide--next-time)
12. [All Files Content](#12-all-files-content)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. My Setup Details

| Item | Value |
|---|---|
| EC2 Public IP (Elastic) | 13.200.105.164 |
| EC2 Instance Type | m7i-flex.large (8GB RAM, 2 vCPU) |
| OS | Ubuntu 22.04 |
| Todo App URL | http://todo.13.200.105.164.nip.io |
| Kafka UI | http://13.200.105.164:8080 |
| Kibana | http://13.200.105.164:5601 |
| Elasticsearch | http://13.200.105.164:9200 |
| Debezium API | http://13.200.105.164:8083 |
| GRAFANA |  http://13.200.105.164:32000 |
| Prometheus |  http://13.200.105.164:30090|
| Docker Hub | 2024dock |
| DB Name | my_todo_db |
| DB User | my_app_user |
| DB Password | 1234 |

---

## 2. Architecture

```
Internet
    │
    ▼
EC2 (13.200.105.164) — Elastic IP
    │
    ├── Minikube (Docker driver) — 192.168.49.2
    │       ├── Nginx Ingress (port 80)
    │       │       ├── /api  → backend pods (Node.js)
    │       │       └── /     → frontend pods (React+Nginx)
    │       └── HPA (auto scaling)
    │
    ├── PostgreSQL (native EC2 — port 5432)
    │       └── my_todo_db
    │
    └── CDC Stack (Docker Compose)
            ├── Zookeeper (port 2181)
            ├── Kafka (port 29092)
            ├── Debezium/Kafka Connect (port 8083)
            ├── Logstash (Kafka → Elasticsearch bridge)
            ├── Elasticsearch (port 9200)
            ├── Kibana (port 5601)
            └── Kafka UI (port 8080)

CDC Data Flow:
PostgreSQL (WAL) → Debezium → Kafka → Logstash → Elasticsearch → Kibana

Request Flow:
Browser → EC2:80 → socat → Minikube Ingress → pods → PostgreSQL
```

---

## 2. EC2 Security Group — Inbound Rules

| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | HTTP (Todo App via Ingress) |
| 8080 | Kafka UI |
| 8083 | Debezium API |
| 9200 | Elasticsearch |
| 5601 | Kibana |
| 30080 | K8s NodePort (optional) |

---

## 3. EC2 Machine Setup

### Install Docker

```bash
sudo apt-get update
sudo apt-get install -y docker.io socat netcat-openbsd curl unzip
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

### postgresql.conf — Edit config

```bash
sudo nano /etc/postgresql/*/main/postgresql.conf
```

Set these values:
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

Add at the end:
```
# Minikube pods ke liye
host    my_todo_db    my_app_user    192.168.49.0/24    md5
host    my_todo_db    my_app_user    172.17.0.0/16      md5

# Debezium CDC replication ke liye
local   replication     my_app_user                     trust
host    replication     my_app_user    172.17.0.0/16    md5
host    replication     my_app_user    172.18.0.0/16    md5
host    replication     my_app_user    127.0.0.1/32     md5
```

### Restart and Verify

```bash
sudo systemctl restart postgresql

# Verify WAL level
sudo -u postgres psql -c "SHOW wal_level;"
# Expected output: logical

# Verify listening on all interfaces
sudo ss -tlnp | grep 5432
# Expected: 0.0.0.0:5432  (NOT 127.0.0.1)
```

### Setup for Debezium CDC (One-time)

```bash
# REPLICA IDENTITY set karo
sudo -u postgres psql -d my_todo_db -c "ALTER TABLE todos REPLICA IDENTITY FULL;"

# Publication banao (superuser se)
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
REACT_APP_API_URL=http://localhost:5000 npm start    # http://localhost:3000
```

### Or Docker Compose (easiest)

```bash
cd todo-app
docker-compose up --build
# Frontend: http://localhost:3000
# Backend:  http://localhost:5000
```

---

## 6. Docker Image Build & Push

> **IMPORTANT:** `node_modules` locally install karo pehle. EC2 pe Docker ke andar `npm install` karne se DNS timeout hota hai. Dockerfiles local `node_modules` copy karti hain.

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

# REACT_APP_API_URL build time pe image mein bake hota hai
docker build \
  --build-arg REACT_APP_API_URL=http://todo.13.200.105.164.nip.io \
  -t 2024dock/todo-frontend:v1 .
docker push 2024dock/todo-frontend:v1
```

### Verify frontend image mein sahi URL baked hai

```bash
docker run --rm 2024dock/todo-frontend:v1 \
  grep -o "13.200.105.164" /usr/share/nginx/html/static/js/main.*.js
# Output: 13.200.105.164
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
minikube ip    # Usually: 192.168.49.2
kubectl get nodes
```

### Port 80 forward — Permanent systemd service

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

## 8. Kubernetes Deployment

### Folder Structure

```
todo-app/k8s/
├── 00-namespace.yaml
├── 01-configmap-secret.yaml
├── 03-backend.yaml
├── 04-frontend.yaml
├── 05-ingress.yaml
└── 06-hpa.yaml
```

### Deploy All

```bash
cd todo-app/k8s
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-configmap-secret.yaml
kubectl apply -f 03-backend.yaml
kubectl apply -f 04-frontend.yaml
kubectl apply -f 05-ingress.yaml
kubectl apply -f 06-hpa.yaml

# Watch pods
kubectl get pods -n todo-app -w
```

### Verify

```bash
# Logs check
kubectl logs -f deployment/backend -n todo-app
# Should show: Database initialized + Backend running on port 5000

# API test
curl http://todo.13.200.105.164.nip.io/api/todos
# Should return JSON

# All resources
kubectl get all -n todo-app
```

---

## 9. Production Domain Setup

### How nip.io works

```
http://todo.13.200.105.164.nip.io
         │
         ▼ (nip.io DNS → 13.200.105.164 automatically)
         │
    EC2 port 80
         │
         ▼ (socat tunnel)
         │
    Minikube 192.168.49.2:80
         │
         ▼ (Nginx Ingress)
         ├── /api → backend-service:5000
         └── /    → frontend-service:80
```

### Verify DNS

```bash
nslookup todo.13.200.105.164.nip.io
# Should show: Address: 13.200.105.164
```

---

## 10. CDC Pipeline Setup

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

### Step 1: Start Stack

```bash
cd ~/todo-app/cdc-stack
docker-compose up -d

# Wait for healthy (2-3 minutes)
docker-compose ps
```

### Step 2: Setup Elasticsearch Index

```bash
chmod +x setup-elasticsearch.sh
./setup-elasticsearch.sh
# Output: {"acknowledged":true}
```

### Step 3: Register Debezium Connector

```bash
chmod +x register-connector.sh
./register-connector.sh

# Verify — both should be RUNNING
curl -s http://localhost:8083/connectors/postgres-connector/status | python3 -m json.tool
```

Expected:
```json
{
  "connector": { "state": "RUNNING" },
  "tasks": [{ "state": "RUNNING" }]
}
```

### Step 4: Verify Data Flow

```bash
# Insert test data
sudo -u postgres psql -d my_todo_db -c "
INSERT INTO todos (title, description, priority)
VALUES ('CDC Test', 'Pipeline test', 'high');
"

sleep 15

# Check Kafka topic
docker exec -it cdc-kafka kafka-topics --list --bootstrap-server localhost:9092
# todo.public.todos should appear

# Check Elasticsearch
curl -s "http://localhost:9200/todos/_count?pretty"
# count should be > 0

# Check Logstash logs
docker logs cdc-logstash --tail 20
```

### Step 5: Browser UIs

| Service | URL |
|---|---|
| Todo App | http://todo.13.200.105.164.nip.io |
| Kafka UI | http://13.200.105.164:8080 |
| Kibana | http://13.200.105.164:5601 |
| Elasticsearch | http://13.200.105.164:9200 |
| Debezium API | http://13.200.105.164:8083 |

### Kibana mein Data Dekhna

```
1. http://13.200.105.164:5601 kholo
2. Left sidebar → Stack Management (⚙️)
3. Kibana → Data Views → Create data view
4. Name: todos
   Index pattern: todos*
   Timestamp: created_at
5. Save karo
6. Left sidebar → Discover (🔍)
7. Dropdown mein "todos" select karo
8. Time range: Last 1 year
```

---

## 11. Restart Guide — Next Time

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

# Minikube IP confirm karo
minikube ip    # 192.168.49.2 hona chahiye
```

### Step 3: socat tunnel start

```bash
sudo systemctl start minikube-tunnel80
sudo systemctl status minikube-tunnel80
```

### Step 4: K8s pods check

```bash
kubectl get pods -n todo-app
# Sabka 1/1 Running hona chahiye

# Agar nahi hain
cd ~/todo-app/k8s
kubectl apply -f .
kubectl get pods -n todo-app -w
```

### Step 5: Todo App verify

```bash
curl http://todo.13.200.105.164.nip.io/api/todos
# JSON response aana chahiye

# Browser mein
# http://todo.13.200.105.164.nip.io
```

### Step 6: CDC stack start

```bash
cd ~/todo-app/cdc-stack
docker-compose up -d
sleep 60
docker-compose ps
# Sabka healthy hona chahiye
```

### Step 7: Debezium connector check

```bash
curl -s http://localhost:8083/connectors/postgres-connector/status | python3 -m json.tool
```

Agar FAILED ya 404 hai:
```bash
cd ~/todo-app/cdc-stack

# Purana slot delete karo
sudo -u postgres psql -d my_todo_db -c \
  "SELECT pg_drop_replication_slot('debezium_slot');" 2>/dev/null || echo "slot nahi tha"

# Delete aur re-register
curl -X DELETE http://localhost:8083/connectors/postgres-connector 2>/dev/null
sleep 5
./register-connector.sh
```

### Step 8: Full verify

```bash
# Kafka topics
docker exec -it cdc-kafka kafka-topics --list --bootstrap-server localhost:9092
# todo.public.todos dikhna chahiye

# Test CDC pipeline
sudo -u postgres psql -d my_todo_db -c "
INSERT INTO todos (title, description, priority)
VALUES ('Restart Test', 'Sab kaam kar raha hai', 'high');
"
sleep 15
curl -s "http://localhost:9200/todos/_count?pretty"
# count > 0 hona chahiye
```

---

## 12. All Files Content

### todo-app/k8s/00-namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: todo-app
  labels:
    app.kubernetes.io/name: todo-app
```

### todo-app/k8s/01-configmap-secret.yaml

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: todo-config
  namespace: todo-app
data:
  DB_HOST: "192.168.49.1"
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
  DB_PASSWORD: MTIzNA==
```

> `MTIzNA==` = `echo -n '1234' | base64`

### todo-app/k8s/03-backend.yaml

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: todo-app
  labels:
    app: backend
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

### todo-app/k8s/04-frontend.yaml

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: todo-app
  labels:
    app: frontend
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

### todo-app/k8s/05-ingress.yaml

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
    # Isse /api/todos → / ban jaata hai → "Cannot GET /" error
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

### todo-app/k8s/06-hpa.yaml

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

### todo-app/cdc-stack/docker-compose.yml

```yaml
version: '3.9'

services:

  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    container_name: cdc-zookeeper
    restart: unless-stopped
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
    ports:
      - "2181:2181"
    networks:
      - cdc-net
    healthcheck:
      test: ["CMD-SHELL", "echo ruok | nc localhost 2181"]
      interval: 10s
      timeout: 5s
      retries: 5

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    container_name: cdc-kafka
    restart: unless-stopped
    depends_on:
      zookeeper:
        condition: service_healthy
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,PLAINTEXT_HOST://localhost:29092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
      KAFKA_LOG_RETENTION_HOURS: 24
    ports:
      - "29092:29092"
    networks:
      - cdc-net
    healthcheck:
      test: ["CMD-SHELL", "kafka-broker-api-versions --bootstrap-server localhost:9092"]
      interval: 15s
      timeout: 10s
      retries: 5

  kafka-connect:
    image: debezium/connect:2.4
    container_name: cdc-debezium
    restart: unless-stopped
    depends_on:
      kafka:
        condition: service_healthy
    environment:
      BOOTSTRAP_SERVERS: kafka:9092
      GROUP_ID: debezium-group
      CONFIG_STORAGE_TOPIC: debezium_config
      OFFSET_STORAGE_TOPIC: debezium_offsets
      STATUS_STORAGE_TOPIC: debezium_status
      CONFIG_STORAGE_REPLICATION_FACTOR: 1
      OFFSET_STORAGE_REPLICATION_FACTOR: 1
      STATUS_STORAGE_REPLICATION_FACTOR: 1
    ports:
      - "8083:8083"
    networks:
      - cdc-net
    extra_hosts:
      - "host.docker.internal:host-gateway"
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8083/connectors || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 10

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    container_name: cdc-elasticsearch
    restart: unless-stopped
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - "9200:9200"
    volumes:
      - es_data:/usr/share/elasticsearch/data
    networks:
      - cdc-net
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9200/_cluster/health || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 10

  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    container_name: cdc-logstash
    restart: unless-stopped
    environment:
      - LS_JAVA_OPTS=-Xms256m -Xmx256m
      - XPACK_MONITORING_ENABLED=false
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      elasticsearch:
        condition: service_healthy
      kafka:
        condition: service_healthy
    networks:
      - cdc-net

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    container_name: cdc-kibana
    restart: unless-stopped
    depends_on:
      elasticsearch:
        condition: service_healthy
    environment:
      ELASTICSEARCH_HOSTS: http://elasticsearch:9200
    ports:
      - "5601:5601"
    networks:
      - cdc-net

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    container_name: cdc-kafka-ui
    restart: unless-stopped
    depends_on:
      - kafka
    environment:
      KAFKA_CLUSTERS_0_NAME: local
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
      KAFKA_CLUSTERS_0_ZOOKEEPER: zookeeper:2181
    ports:
      - "8080:8080"
    networks:
      - cdc-net

volumes:
  es_data:

networks:
  cdc-net:
    driver: bridge
```

### todo-app/cdc-stack/logstash.conf

```
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["todo.public.todos"]
    codec => "json"
    auto_offset_reset => "earliest"
    group_id => "logstash-group"
  }
}

filter {
  if [after] {
    mutate {
      add_field => {
        "title"       => "%{[after][title]}"
        "completed"   => "%{[after][completed]}"
        "priority"    => "%{[after][priority]}"
        "created_at"  => "%{[after][created_at]}"
        "updated_at"  => "%{[after][updated_at]}"
        "todo_id"     => "%{[after][id]}"
      }
    }
    mutate {
      add_field => { "operation" => "%{op}" }
    }
    mutate {
      remove_field => ["before", "after", "source", "transaction", "op", "ts_ms", "@version"]
    }
  }
}

output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "todos"
    document_id => "%{todo_id}"
  }
  stdout { codec => rubydebug }
}
```

### todo-app/cdc-stack/debezium-connector.json

```json
{
  "name": "postgres-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "host.docker.internal",
    "database.port": "5432",
    "database.user": "my_app_user",
    "database.password": "1234",
    "database.dbname": "my_todo_db",
    "topic.prefix": "todo",
    "table.include.list": "public.todos",
    "plugin.name": "pgoutput",
    "slot.name": "debezium_slot",
    "publication.name": "debezium_pub",
    "key.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "key.converter.schemas.enable": "false",
    "value.converter.schemas.enable": "false",
    "decimal.handling.mode": "string",
    "snapshot.mode": "initial"
  }
}
```

### todo-app/cdc-stack/register-connector.sh

```bash
#!/bin/bash
echo "⏳ Waiting for Kafka Connect to be ready..."
until curl -sf http://localhost:8083/connectors > /dev/null; do
  sleep 5
  echo "  still waiting..."
done

echo "✅ Kafka Connect ready!"
echo "📡 Registering Debezium PostgreSQL connector..."

curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @debezium-connector.json

echo ""
echo "✅ Connector registered! Status check:"
sleep 3
curl -s http://localhost:8083/connectors/postgres-connector/status | python3 -m json.tool
```

### todo-app/cdc-stack/setup-elasticsearch.sh

```bash
#!/bin/bash
echo "⏳ Waiting for Elasticsearch..."
until curl -sf http://localhost:9200/_cluster/health > /dev/null; do
  sleep 5
  echo "  still waiting..."
done

echo "✅ Elasticsearch ready!"
echo "📊 Creating todos index with mapping..."

curl -X PUT http://localhost:9200/todos \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": {
      "properties": {
        "todo_id":     { "type": "keyword" },
        "title":       { "type": "text" },
        "completed":   { "type": "boolean" },
        "priority":    { "type": "keyword" },
        "created_at":  { "type": "date" },
        "updated_at":  { "type": "date" },
        "operation":   { "type": "keyword" }
      }
    }
  }'

echo ""
echo "✅ Elasticsearch index created!"
```

### todo-app/cdc-stack/restart-cdc.sh

```bash
#!/bin/bash
echo "🔄 CDC Stack restart ho raha hai..."

cd ~/todo-app/cdc-stack

echo "⏳ Stack start ho raha hai..."
docker-compose up -d

echo "⏳ Services ready hone ka wait karo (60 sec)..."
sleep 60

echo "📊 Elasticsearch index bana rahe hain..."
./setup-elasticsearch.sh

echo "🗑️ Purana replication slot delete kar rahe hain..."
sudo -u postgres psql -d my_todo_db -c \
  "SELECT pg_drop_replication_slot('debezium_slot');" 2>/dev/null || echo "slot nahi tha"

echo "🗑️ Purana connector delete kar rahe hain..."
curl -X DELETE http://localhost:8083/connectors/postgres-connector 2>/dev/null
sleep 5

echo "📡 Connector register kar rahe hain..."
./register-connector.sh

echo ""
echo "✅ CDC Stack ready!"
docker-compose ps
```

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm ci` fails | No package-lock.json | `npm install` use karo |
| Docker build `EAI_AGAIN` | Docker DNS issue | `/etc/docker/daemon.json` mein `{"dns":["8.8.8.8","8.8.4.4"]}` |
| `ErrImageNeverPull` | Wrong imagePullPolicy | `imagePullPolicy: Always` + full `username/image:tag` |
| `ErrImagePull` pull denied | Username missing in image name | `2024dock/todo-backend:v1` use karo |
| Backend "DB not ready" | Postgres sirf `127.0.0.1` pe | `listen_addresses = '*'` postgresql.conf mein |
| Backend pods CrashLoopBackOff | Wrong DB credentials in ConfigMap | `kubectl get cm todo-config -n todo-app -o yaml` check karo |
| `host.minikube.internal` resolve nahi | Docker driver support nahi | `DB_HOST: 192.168.49.1` use karo |
| UI loads lekin "Failed to connect" | Frontend wrong API URL | Rebuild: `--build-arg REACT_APP_API_URL=http://todo.13.200.105.164.nip.io` |
| `Cannot GET /` API pe | `rewrite-target: /` annotation | Ingress se yeh annotation hatao |
| nip.io URL nahi khulta | socat tunnel nahi chal raha | `sudo systemctl start minikube-tunnel80` |
| Minikube start fails (memory) | RAM kam hai | `minikube start --memory=6g` ya instance upgrade karo |
| Debezium: `permission denied WAL sender` | REPLICATION permission nahi | `ALTER USER my_app_user REPLICATION;` |
| Debezium: `must be superuser for publication` | User superuser nahi | `CREATE PUBLICATION debezium_pub FOR TABLE public.todos;` manually |
| Debezium task FAILED restart ke baad | Replication slot already exists | `SELECT pg_drop_replication_slot('debezium_slot');` |
| Elasticsearch count = 0 | Logstash/connector not running | `docker logs cdc-logstash --tail 20` check karo |
| Kibana "No available fields" | Time range issue | Time range "Last 1 year" set karo |
| CDC stack down ke baad connector missing | Connector restart se delete | `./restart-cdc.sh` chalao |

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
│   │   ├── App.js
│   │   ├── App.css
│   │   └── index.js
│   ├── public/index.html
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── k8s/
│   ├── 00-namespace.yaml
│   ├── 01-configmap-secret.yaml
│   ├── 03-backend.yaml
│   ├── 04-frontend.yaml
│   ├── 05-ingress.yaml
│   └── 06-hpa.yaml
├── cdc-stack/
│   ├── docker-compose.yml
│   ├── logstash.conf
│   ├── debezium-connector.json
│   ├── register-connector.sh
│   ├── setup-elasticsearch.sh
│   └── restart-cdc.sh
└── docker-compose.yml    (todo app local dev)
```

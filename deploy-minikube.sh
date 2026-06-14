#!/usr/bin/env bash
# =============================================================
# deploy-minikube.sh  —  Deploy Todo App to Minikube on EC2
# =============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── 1. Preflight checks ─────────────────────────────────────
for cmd in minikube kubectl docker; do
  command -v "$cmd" &>/dev/null || error "$cmd is not installed"
done
info "Preflight checks passed"

# ── 2. Start Minikube (if not running) ──────────────────────
if ! minikube status | grep -q "Running"; then
  info "Starting Minikube..."
  minikube start \
    --driver=docker \
    --cpus=2 \
    --memory=3g \
    --addons=ingress,metrics-server \
    --container-runtime=containerd
else
  info "Minikube already running"
  minikube addons enable ingress      2>/dev/null || true
  minikube addons enable metrics-server 2>/dev/null || true
fi

# ── 3. Point Docker CLI to Minikube's Docker daemon ─────────
info "Switching Docker context to Minikube..."
eval "$(minikube docker-env)"

# ── 4. Build images inside Minikube ─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MINIKUBE_IP=$(minikube ip)

info "Building backend image..."
docker build -t todo-backend:latest "$SCRIPT_DIR/backend"

info "Building frontend image (API_URL=http://$MINIKUBE_IP:30080)..."
docker build \
  --build-arg REACT_APP_API_URL="http://$MINIKUBE_IP:30080" \
  -t todo-frontend:latest \
  "$SCRIPT_DIR/frontend"

# ── 5. Deploy Kubernetes manifests ──────────────────────────
info "Applying Kubernetes manifests..."
kubectl apply -f "$SCRIPT_DIR/k8s/00-namespace.yaml"
kubectl apply -f "$SCRIPT_DIR/k8s/01-configmap-secret.yaml"
kubectl apply -f "$SCRIPT_DIR/k8s/02-postgres.yaml"

info "Waiting for PostgreSQL to be ready..."
kubectl rollout status deployment/postgres -n todo-app --timeout=120s

kubectl apply -f "$SCRIPT_DIR/k8s/03-backend.yaml"
info "Waiting for backend to be ready..."
kubectl rollout status deployment/backend -n todo-app --timeout=120s

kubectl apply -f "$SCRIPT_DIR/k8s/04-frontend.yaml"
kubectl apply -f "$SCRIPT_DIR/k8s/05-ingress.yaml"
kubectl apply -f "$SCRIPT_DIR/k8s/06-hpa.yaml"

info "Waiting for frontend to be ready..."
kubectl rollout status deployment/frontend -n todo-app --timeout=120s

# ── 6. Print access info ─────────────────────────────────────
echo ""
echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}  ✅ Todo App Deployed Successfully!  ${NC}"
echo -e "${GREEN}=======================================${NC}"
echo ""
echo "  Minikube IP    : $MINIKUBE_IP"
echo "  Frontend URL   : http://$MINIKUBE_IP:30080"
echo "  Backend API    : http://$MINIKUBE_IP:30080/api"
echo ""
echo "  For EC2 access, open Security Group port 30080"
echo "  Or use: ssh -L 3000:$MINIKUBE_IP:30080 <ec2-user>@<ec2-ip>"
echo ""
echo -e "  Pods status:"
kubectl get pods -n todo-app
echo ""

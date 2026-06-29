#!/bin/bash
# Monitoring ports ko EC2 se access karne ke liye socat tunnels

MINIKUBE_IP=$(minikube ip)
echo "Minikube IP: $MINIKUBE_IP"

# Prometheus - port 30090
sudo socat TCP-LISTEN:30090,fork TCP:$MINIKUBE_IP:30090 &
echo "✅ Prometheus tunnel: http://13.200.105.164:30090"

# Grafana - port 32000
sudo socat TCP-LISTEN:32000,fork TCP:$MINIKUBE_IP:32000 &
echo "✅ Grafana tunnel: http://13.200.105.164:32000"

echo ""
echo "Browser mein access karo:"
echo "  Prometheus: http://13.200.105.164:30090"
echo "  Grafana:    http://13.200.105.164:32000"
echo "  Grafana Login: admin / admin123"
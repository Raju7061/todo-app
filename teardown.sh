#!/usr/bin/env bash
# Tear down the todo-app from Kubernetes
set -e

echo "🗑️  Deleting todo-app namespace and all resources..."
kubectl delete namespace todo-app --ignore-not-found=true

echo "✅ Done. Minikube is still running."
echo "   To also stop Minikube: minikube stop"
echo "   To delete Minikube:    minikube delete"

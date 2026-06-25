#!/bin/bash
# Debezium connector register karne ka script

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
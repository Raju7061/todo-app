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
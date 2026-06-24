#!/bin/bash
# Elasticsearch index aur mapping create karne ka script

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
        "id":          { "type": "keyword" },
        "title":       { "type": "text", "analyzer": "standard" },
        "description": { "type": "text", "analyzer": "standard" },
        "completed":   { "type": "boolean" },
        "priority":    { "type": "keyword" },
        "created_at":  { "type": "date" },
        "updated_at":  { "type": "date" }
      }
    }
  }'

echo ""
echo "✅ Elasticsearch index created!"
echo "🔍 Check: http://localhost:9200/todos"
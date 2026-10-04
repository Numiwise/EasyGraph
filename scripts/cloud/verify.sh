#!/bin/bash
echo "=== 公网首页 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://1.14.192.68:5806/

echo "=== g00 WebUI ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://1.14.192.68:5806/lightrag/g00_master_all/webui/

echo "=== g00 query (无 key, nginx 自动注入) ==="
printf '%s' '{"query":"荔枝品种","mode":"local","top_k":3}' | \
  curl -s -X POST -H "Content-Type: application/json" --data-binary @- \
    -o /dev/null -w "HTTP %{http_code}\n" \
    http://1.14.192.68:5806/lightrag/g00_master_all/query/data

echo "=== 7 个工作区 health ==="
for ws in g00_master_all g01_people_literature g02_places_routes g03_varieties \
          g04_history_institutions g05_lingnan_liwan g06_industry_tech; do
  curl -s -o /dev/null -w "$ws: %{http_code}\n" \
    http://1.14.192.68:5806/lightrag/$ws/health
done

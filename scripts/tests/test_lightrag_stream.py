import json
import urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:9621/query/stream",
    data=json.dumps({
        "query": "涪州到长安",
        "mode": "mix",
        "include_references": True,
        "include_chunk_content": True,
        "top_k": 3,
        "chunk_top_k": 3,
    }).encode(),
    headers={"Content-Type": "application/json"},
)
out = urllib.request.urlopen(req, timeout=60).read().decode()
print(out[:5000])
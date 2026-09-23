"""Reproduce the 422 error user saw, capture server response body."""
import json
import urllib.request
import urllib.error

req = urllib.request.Request(
    "http://127.0.0.1:9621/query/stream",
    data=json.dumps({
        "query": "有哪些出名出产荔枝产区",
        "mode": "mix",
        "include_references": True,
        "include_chunk_content": True,
        "top_k": 12,
        "chunk_top_k": 6,
    }).encode(),
    headers={"Content-Type": "application/json"},
)

try:
    out = urllib.request.urlopen(req, timeout=60).read().decode()
    print("OK len:", len(out))
except urllib.error.HTTPError as e:
    print("HTTPError", e.code, e.reason)
    print(e.read().decode())
except Exception as e:
    print("Other:", repr(e))
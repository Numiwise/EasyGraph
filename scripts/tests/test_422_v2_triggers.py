"""Reproduce 422 from lightrag /query/stream with various payloads."""
import json
import urllib.request
import urllib.error


def try_post(label, body):
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:9621/query/stream",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        out = urllib.request.urlopen(req, timeout=20)
        out = out.read().decode()
        print(f"[{label}] OK len={len(out)}")
    except urllib.error.HTTPError as e:
        print(f"[{label}] HTTPError {e.code} {e.reason}")
        try:
            print("    body:", e.read().decode()[:300])
        except Exception:
            pass


# 1. Baseline (what frontend actually sends)
try_post("baseline",
    {"query": "有哪些出名出产荔枝产区", "mode": "mix", "include_references": True,
     "include_chunk_content": True, "response_type": "请用中文", "top_k": 12, "chunk_top_k": 6})

# 2. Too short query
try_post("short_query", {"query": "ab", "mode": "mix"})

# 3. Empty response_type (force validation)
try_post("bad_response_type",
    {"query": "有哪些出名出产荔枝产区", "mode": "mix", "response_type": ""})

# 4. top_k out of range (must be 1..MAX_QUERY_TOP_K)
try_post("big_top_k",
    {"query": "有哪些出名出产荔枝产区", "mode": "mix", "top_k": 100000, "chunk_top_k": 6})

# 5. Wrong mode
try_post("bad_mode", {"query": "有哪些出名出产荔枝产区", "mode": "abc"})

# 6. Null query
try_post("null_query", {"query": None, "mode": "mix"})
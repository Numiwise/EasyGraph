"""复现前端实际发出的 /query/stream body，确认 422 字段。"""
import json
import urllib.request
import urllib.error

# 完全镜像前端 streamRag 的 body
body = json.dumps({
    "query": "有哪些出名出产荔枝产区",
    "mode": "mix",
    "include_references": True,
    "include_chunk_content": True,
    "response_type": "中文直接回答。开门见山，分点论据；引用用行内 [1][2]，禁止 REFxx；不输出思考块<think>、不复述问题、不写开场白；文末不要 ### References 清单。",
    "top_k": 12,
    "chunk_top_k": 6,
}).encode()
print("body length:", len(body))
print("response_type length:", len("中文直接回答。开门见山，分点论据；引用用行内 [1][2]，禁止 REFxx；不输出思考块<think>、不复述问题、不写开场白；文末不要 ### References 清单。"))

req = urllib.request.Request(
    "http://127.0.0.1:9621/query/stream",
    data=body,
    headers={"Content-Type": "application/json"})
try:
    out = urllib.request.urlopen(req, timeout=90).read().decode()
    print("OK:", out[:200])
except urllib.error.HTTPError as e:
    print("HTTPError", e.code, e.reason)
    print("body:", e.read().decode())
"""最小化 /query/stream 冒烟测试：向第 9621 端口（总图谱）发一次流式请求，
打印前 5000 字节原文。用于快速确认 LightRAG 服务在跑且流式协议正常。"""
import json
import urllib.request

# 拼接 POST 请求体（字段与前端 streamRag 保持一致）
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
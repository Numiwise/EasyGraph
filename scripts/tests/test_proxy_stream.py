"""经 nginx 反代测试流式(SSE) + 非流式，确认前端可用。"""
import json
import urllib.request
import urllib.error

# 非流式
body = json.dumps({
    "model": "deepseek-ai/DeepSeek-V3",
    "messages": [{"role": "user", "content": "用一句话介绍荔枝"}],
    "max_tokens": 120,
    "stream": False,
}).encode()
req = urllib.request.Request(
    "http://host.docker.internal:5006/llm/chat/completions",
    data=body, headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=90)
    d = json.loads(r.read().decode())
    print("non-stream OK:", d["choices"][0]["message"]["content"][:120])
except Exception as e:
    print("non-stream ERR:", repr(e)[:300])

# 流式
body2 = json.dumps({
    "model": "deepseek-ai/DeepSeek-V3",
    "messages": [{"role": "user", "content": "用一句话介绍荔枝"}],
    "max_tokens": 120,
    "stream": True,
}).encode()
req2 = urllib.request.Request(
    "http://host.docker.internal:5006/llm/chat/completions",
    data=body2, headers={"Content-Type": "application/json"})
try:
    r2 = urllib.request.urlopen(req2, timeout=90)
    chunks = []
    for line in r2.read().decode().split("\n"):
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload and payload != "[DONE]":
                try:
                    o = json.loads(payload)
                    c = o["choices"][0]["delta"].get("content")
                    if c:
                        chunks.append(c)
                except Exception:
                    pass
    print("stream OK:", "".join(chunks)[:120])
except Exception as e:
    print("stream ERR:", repr(e)[:300])

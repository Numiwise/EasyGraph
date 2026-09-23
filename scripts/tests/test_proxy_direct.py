"""经 nginx 反代(host.docker.internal:5006/llm/) vs 直连 SiliconFlow 对比。"""
import json
import urllib.request
import urllib.error

body = json.dumps({
    "model": "deepseek-ai/DeepSeek-V3",
    "messages": [{"role": "user", "content": "hi"}],
}).encode()

for label, url in [
    ("proxy", "http://host.docker.internal:5006/llm/chat/completions"),
    ("direct", "https://api.siliconflow.cn/v1/chat/completions"),
]:
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=90)
        print(f"[{label}] OK:", r.read().decode()[:200])
    except urllib.error.HTTPError as e:
        print(f"[{label}] HTTP {e.code}:", e.read().decode()[:200])
    except Exception as e:
        print(f"[{label}] ERR:", repr(e)[:300])

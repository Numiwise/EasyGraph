"""用 LightRAG 环境的 OpenAI SDK 实测 SiliconFlow chat completion，定位 20015 原因。

安全：key 从环境变量 SILICONFLOW_API_KEY 读取（或用 LLM_BINDING_API_KEY），不写死在代码里。
运行：先设环境变量（PowerShell: $env:SILICONFLOW_API_KEY='sk-...'）。
"""
import os
import sys
sys.path.insert(0, "/app")

from openai import OpenAI

# key 优先 SILICONFLOW_API_KEY，其次 LLM_BINDING_API_KEY（都不设则报错提示）
_api_key = os.environ.get("SILICONFLOW_API_KEY") or os.environ.get("LLM_BINDING_API_KEY")
if not _api_key:
    sys.exit("请设置环境变量 SILICONFLOW_API_KEY 或 LLM_BINDING_API_KEY 再运行。")

client = OpenAI(
    api_key=_api_key,
    base_url="https://api.siliconflow.cn/v1",
    timeout=60,
)

# 方式1：最简（不带 max_tokens）
try:
    r = client.chat.completions.create(
        model="deepseek-ai/DeepSeek-V3",
        messages=[{"role": "user", "content": "hi"}],
    )
    print("OK1:", r.choices[0].message.content[:80])
except Exception as e:
    print("ERR1:", repr(e)[:300])

# 方式2：带 max_tokens + stream
try:
    r = client.chat.completions.create(
        model="deepseek-ai/DeepSeek-V3",
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=512,
        stream=True,
    )
    parts = [chunk.choices[0].delta.content for chunk in r if chunk.choices and chunk.choices[0].delta.content]
    print("OK2:", "".join(parts)[:80])
except Exception as e:
    print("ERR2:", repr(e)[:300])

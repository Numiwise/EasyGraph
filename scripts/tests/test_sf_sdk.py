"""用 LightRAG 环境的 OpenAI SDK 实测 SiliconFlow chat completion，定位 20015 原因。"""
import os
import sys
sys.path.insert(0, "/app")

from openai import OpenAI

client = OpenAI(
    api_key="sk-tnfbxqnjsiqbwbsdhikypadmnwiuzrvtjwcrjubwgyfdhwsi",
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

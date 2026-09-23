# LightRAG 自定义回答生成 Prompt（覆盖版）

## 目标

让 LLM（SiliconFlow DeepSeek-V3）输出「直接、开门见山、行内 `[n]` 引用、无思考块、无 References 列表」的答案，匹配前端「引用气泡 + 点击开原网页」的交互。

## 方案

LightRAG v1.5.6 把所有 prompt 模板放在容器内的 `/app/lightrag/prompt.py` 里，运行时由 `import lightrag.prompt` 加载。我们用 **Docker bind mount** 在不改镜像的前提下覆盖：

```yaml
volumes:
  - ./data/lightrag_overrides/prompt.py:/app/lightrag/prompt.py:ro
```

重启所有 7 个 LightRAG 容器即可生效；构建/升级镜像也不影响。

> 注意：覆盖整个 prompt.py 而不是 patch 部分行，是因为整个文件其它部分（PROMPTS 字典其余键、PROMPT_DIR 解析函数等）必须保留，否则 `import lightrag.prompt` 会失败。

## 文件

- `prompt.py`  — 自定义覆盖版（43 KB），与容器内的 `lightrag/prompt.py` 同源，仅修改回答生成的两处 instruction。
- `prompt_base.py`  — 上一版 in-container 副本（仅备查，不挂载）。

## 改动定位（搜索 `CUSTOM:`）

打开 `prompt.py` 搜索：

1. `===== CUSTOM: rag_response =====` — `PROMPTS["rag_response"]`（标准 RAG 模式），第 1 段指令。
2. `===== CUSTOM: mix_rag_response =====` — `PROMPTS["mix_rag_response"]`（mix 模式），第 1 段指令。

两处都做了同样替换：

| 原文（官方） | 新文（覆盖） |
|---|---|
| `Generate a **References** section at the end of the response.` | `Use ONLY inline citations like [1] [2] in the running text. Do NOT use REF/REFxx/REF0/REF1 formats.` |
| `Do not generate anything after the reference section.` | `Do NOT append a "References" section or any reference list at the end of the response (the front-end renders its own citation popovers). Do NOT include any thinking process, self-reflection, <think>/<thinking>/«think» blocks. Do NOT restate the user query. Get straight to the point.` |

## 部署步骤

```bash
# 1. 拷贝覆盖文件到挂载点（其实已在仓库里，无需再 cp）
ls data/lightrag_overrides/prompt.py

# 2. 在 docker-compose.yml 给 7 个 LightRAG 服务加一条 volume（已有 *_lightrag-volumes 锚点，加一次即可）
#    volumes:
#      - ./data/lightrag_overrides/prompt.py:/app/lightrag/prompt.py:ro

# 3. 重启
docker compose restart lightrag lightrag-g01 lightrag-g02 lightrag-g03 lightrag-g04 lightrag-g05 lightrag-g06

# 4. 验证（看版本是否被覆盖）
docker exec lightrag-server head -3 /app/lightrag/prompt.py
```

## 风险

1. **容器内 in-place patch 与本次覆盖并存** — 之前我们用 `scripts/patch_lightrag_prompt.py` 已经把容器内的 prompt.py 改成了同样的两段。覆盖版只会在重启后**覆盖**容器内文件，效果不变。
2. **LLM 偶尔仍会输出残余 thinking** — 前端 `normCite()` 已做兜底剥除，**用户视角看到的应该是干净的**。
3. **`response_type` 参数对某些 query 模式可能覆盖部分指令** — 前端 `streamRag` 仍传 `response_type` 兜底，与这里的指令不冲突。

## 验证方式

打开 `http://localhost:5006/#/query/g02_places_routes` 问"涪州到长安的荔枝路线"，应该看到：

- 答案开头没有 "以下是回答" / 思考块
- 引用是 `[1] [2]` 格式，紧跟在句末
- 末尾没有 `### References` 列表
- 鼠标悬到 `[1]` 上 → 显示对应 chunk 气泡 → 点击开原网页（开的是该 `[1]` 引用的真实文件，而不是错位）
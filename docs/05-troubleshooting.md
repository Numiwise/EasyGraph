# 故障排查

> 80% 的问题集中在三类：**配置错误 / 资源不足 / 数据问题**。本文按现象给出快速诊断步骤。

## 1. 启动问题

### 服务一直 `Restarting`

```bash
docker compose ps           # 看状态
docker compose logs neo4j  # 看具体错误
```

**常见原因**：

| 现象 | 解决 |
|------|------|
| Neo4j 报 "another instance already running" | 内存不够 → 调小 `NEO4J_server_memory_heap_max__size` |
| LightRAG "Failed to connect to Neo4j" | Neo4j 没就绪，等 30 秒；或 NEO4J_PASSWORD 不一致 |
| LightRAG "LLM API key invalid" | 检查 `.env` 里 `LLM_BINDING_API_KEY` 是否正确 |
| LightRAG "Vector store connection refused" | Qdrant 没就绪 |

### 端口被占用

```bash
# 查看占用
netstat -ano | findstr "5006"
# 或
lsof -i :5006
```

修改 `docker-compose.yml` 端口映射（如 `"5007:80"`）或 `HOST/PORT`（如 `HOST=127.0.0.1 PORT=9622`）。

## 2. LightRAG 422 错误

最常见的两个：

### `response_type 超过 256 字符`

`frontend/src/api/lightrag.js` 中 `responseType` 字符串含 `<think>` 标签等长内容。
**解决**：精简到 ≤256 字符。本项目已精简。

### `query 长度 < 3`

LightRAG Pydantic 校验 `min_length=3`。本项目前端已校验（`validateOpt()`）。

### `top_k > 1000`

LightRAG Pydantic 限制 `top_k` ≤ 1000。本项目前端默认 `topK=12, chunkTopK=6`，安全。

## 3. AI 回答没有引用

**症状**：回答生成成功，但没有 `[n]` 引用。

**排查**：

1. `include_references: true`（本项目 `streamRag()` 已设）
2. 检索到的 chunk 有 `file_path`（检查 `data/inputs/<ws>/__parsed__/*.md` 不为空）
3. Neo4j 中实体已建立关联（关系数 > 实体数）
4. 切换工作区 → 验证 `WORKSPACE` 与实体 Label 是否匹配

## 4. 前端无法连 Neo4j

**症状**：首页打开后图谱不渲染或"等待连接"。

**排查**：

```bash
# 1) 检查 Neo4j-display 容器状态
docker compose ps neo4j-display

# 2) 检查 Bolt 端口 7688 是否监听
docker compose exec neo4j-display bash -c 'ss -tlnp | grep 7687'

# 3) 测试浏览器直连
# 浏览器访问 webviz 静态页面 → 打开 DevTools Console 看 neo4j-web 的报错
```

**常见原因**：

- Neo4j-display 未启动完整数据初始化（首次启动 + 同步完整版数据较慢）
- 浏览器 bolt 协议被代理或防火墙阻挡
- `neo4j-driver`（neo4j-web.js）版本与 Neo4j 5.26 不兼容

## 5. 前端 CSS 看起来不对

**症状**：样式丢失或混乱。

**排查**：检查 `frontend/index.html` 引入了所有 5 个 CSS：

```html
<link rel="stylesheet" href="src/styles/main.css">
<link rel="stylesheet" href="src/styles/home.css">
<link rel="stylesheet" href="src/styles/graph.css">
<link rel="stylesheet" href="src/styles/query.css">
<link rel="stylesheet" href="src/styles/doc.css">
```

CSS 已按 view 拆分：共性在 `main.css`，个性在各 view css。

## 6. AI 后加工（深度加工）

当前**未启用二次 LLM**。LightRAG 直接返回的回答已经过 `response_type` 约束（基于检索资料、不编造、不联网）。如需"格式化整理"，未来版本会加 `/llm/` 反代的前端二次加工。

## 7. 图谱无数据 / 空节点

**排查**：

```bash
# 查看 Neo4j 节点数
docker exec -it lightrag-neo4j bash
cypher-shell -u neo4j -p <你的密码>
> MATCH (n) RETURN count(n);
> MATCH (n:g00_master_all) RETURN count(n) LIMIT 5;
```

**常见原因**：

- LightRAG 未成功 ingest（看 `logs/ingest_*.log`）
- WORKSPACE 不匹配（节点标签与查询的 ws 不一致）
- 原始资料未解析（`data/inputs/<ws>/__parsed__/` 为空）

## 8. Qdrant 报错

`collection not found`：

```bash
# 检查 LightRAG 是否创建了 collection
curl http://localhost:6333/collections
```

如果是空的，LightRAG 还没有 ingest 过任何文档。跑 `docker compose exec lightrag /lightrag-ingest`。

## 9. 反向代理 / 网络问题

浏览器通过 webviz:5006 的 `/llm/` 反代访问 LLM。如果 502：

```bash
# webviz 容器内测试
docker compose exec webviz wget -O- https://api.siliconflow.cn/v1/models
# 若超时：检查宿主能否访问该 URL
```

如果宿主能访问但容器不行，是 DNS 问题。`docker-compose.yml` 中 webviz 服务加 `dns: [8.8.8.8, 1.1.1.1]`。

## 10. 测试失败

```bash
# 跑详细输出
python -m pytest tests/ -v

# 跑单个测试
python -m pytest tests/test_smoke.py::test_docker_compose_valid_yaml -v
```

常见：

| 错误 | 解决 |
|------|------|
| `PyYAML 未安装` | `pip install pyyaml` |
| `缺少 CSS: graph.css` | 确认 `frontend/src/styles/` 有 5 个 css |
| `原始资料 manifest 不存在` | 首次未 ingest，先跑 `docker compose exec lightrag /lightrag-ingest` |

## 仍然解决不了？

收集这些信息：

```bash
docker compose ps > /tmp/status.txt
docker compose logs --tail=200 > /tmp/logs.txt
docker version > /tmp/docker.txt
python -m pytest tests/ -v > /tmp/tests.txt 2>&1
```

到 GitHub Issues 提交时附上这些文件。
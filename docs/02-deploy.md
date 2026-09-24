# 详细部署

> 适合首次部署或大规模环境调优使用。日常 5 分钟上手请看 [00-quickstart.md](00-quickstart.md)。

## 部署模式

### 模式 A：完整启动（基础设施 + 总图 + 全部 6 个分图）

```bash
docker compose --profile subgraphs up -d
```

需要约 8GB 内存（Neo4j 1GB + 7×LightRAG 各 500MB + Qdrant + PG + Webviz）。

### 模式 B：只跑总图（推荐日常）

```bash
docker compose up -d
```

约 3GB 内存。**默认模式**，运行时最节省。

### 模式 C：只跑基础设施（无 LightRAG）

```bash
docker compose up -d neo4j qdrant postgres webviz pgadmin
```

适合调试或前端单独运行时。

## 环境变量详解

### 必填项（必须设置才能用）

| 变量 | 作用 | 示例 |
|------|------|------|
| `LLM_BINDING_API_KEY` | LLM 调用密钥 | `sk-...` |
| `NEO4J_PASSWORD` | Neo4j 密码（影响 docker-compose 引用） | 12位以上随机 |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | 12位以上随机 |

### LLM 与 Embedding（默认 SiliconFlow）

`.env.example` 默认用 SiliconFlow（兼容 OpenAI 协议）。要换服务商只需改 3 项：

```bash
LLM_BINDING_HOST=https://api.openai.com/v1   # 改 base URL
LLM_BINDING_API_KEY=sk-...                  # 改 key
LLM_MODEL=gpt-4o-mini                       # 改模型名
```

也可换 DeepSeek、月之暗面、智谱、Ollama（本地）等任何 OpenAI 兼容服务。

### 存储后端切换

LightRAG 默认使用：
- 图 → `NetworkXStorage`（文件 JSON）
- 向量 → `NanoVectorDBStorage`（本地文件）
- KV / DocStatus → `JsonKVStorage`（本地文件）

本项目**生产级**替换：

```bash
LIGHTRAG_GRAPH_STORAGE=Neo4JStorage
LIGHTRAG_VECTOR_STORAGE=QdrantVectorDBStorage
LIGHTRAG_KV_STORAGE=PGKVStorage
LIGHTRAG_DOC_STATUS_STORAGE=PGDocStatusStorage
```

如需切换回文件模式（如本地测试），将以上 4 个改回默认即可。

### Prompt 自定义

```bash
ENTITY_EXTRACTION_USE_JSON=true           # JSON 结构化抽取
ENTITY_TYPE_PROMPT_FILE=lychee_culture.yml  # 你的领域 prompt 文件名
MAX_EXTRACTION_RECORDS=60                 # 单次抽取上限
MAX_EXTRACTION_ENTITIES=30
MAX_GLEANING=2                             # 补抽轮数（古籍/密集型设 2）
```

`ENTITY_TYPE_PROMPT_FILE` 在 `data/prompts/entity_type/` 下，文件名不含 `.yml` 后缀。

## 卷（volume）大小预估

| 卷 | 大小 | 说明 |
|----|------|------|
| `neo4j_data` | ~50MB / 千节点 | 完整版图 |
| `neo4j_display_data` | ~30MB / 千节点 | 展示版（清理后更小） |
| `qdrant_data` | ~100MB | 向量数据（1024 维 + 几千万 chunk） |
| `postgres_data` | ~10MB | LightRAG 元数据 |
| `pgadmin_data` | 几MB | pgAdmin 配置 |

原始资料 `data/inputs/_origin/*.html` 等约 50MB（解析后 markdown）。

## 内存调优

各服务默认内存：

| 服务 | 默认 | 建议 |
|------|------|------|
| Neo4j | 256m-512m | 总数据 > 5 万节点时设 1g-2g |
| LightRAG | 默认 | 大语料或长 chunk 时 ≥ 1g |
| Qdrant | 默认 | 千万级向量时考虑更大内存 |

`docker-compose.yml` 中 Neo4j 的 `NEO4J_server_memory_heap_max__size: 512m` 可调大。

## 启动/停止

```bash
# 启动（后台）
docker compose up -d

# 查看状态
docker compose ps

# 看日志（按服务）
docker compose logs -f neo4j
docker compose logs -f lightrag

# 停止（保留数据卷）
docker compose down

# 彻底清掉（**删除所有数据**）
docker compose down -v
```

## 反向代理与 nginx

`nginx/nginx-webviz.conf` 关键路由：

```nginx
# 前端 SPA
location / { try_files $uri /index.html; }

# 原文（解析后的 markdown）
location /kb/ { alias /kb/; ... }

# LLM 反代（前端浏览器通过这里调 LLM，Authorization 由 nginx 注入）
location /llm/ {
    proxy_pass https://api.siliconflow.cn/v1/;
    proxy_set_header Authorization "Bearer sk-...";
    ...
}
```

**/llm/ 反代避免在 JS 里硬编码 API key**，浏览器只看到 nginx（5006 端口）。

如需修改默认 LLM key，编辑 `nginx/nginx-webviz.conf` 中 `Authorization` 行，重建 webviz：

```bash
docker compose up -d --force-recreate webviz
```

## 启动顺序建议

Neo4j、Qdrant、PostgreSQL 应先就绪，LightRAG 才能连接。`docker-compose.yml` 已用 `depends_on + healthcheck` 保证启动顺序，但你**首次启动**最好等 30 秒再访问：

```bash
docker compose up -d
sleep 30
docker compose ps  # 确认所有 healthy
```

## 高可用与扩展

- **Neo4j**：可换集群版 `neo4j/neo4j-cluster`；生产建议外置 NAS 备份卷
- **Qdrant**：支持集群模式；性能不够可换 Weaviate / Milvus
- **PostgreSQL**：可用 pgvector 替代 Qdrant（`LIGHTRAG_VECTOR_STORAGE=PGVectorStorage`）
- **多机部署**：将 LightRAG 实例拆出独立 compose，共享外部 DB 服务

详见 [docs/05-troubleshooting.md](05-troubleshooting.md) 性能问题章节。
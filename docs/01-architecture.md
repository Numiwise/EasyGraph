# 系统架构

## 顶层架构图

```
┌────────────────────────────────────────────────────────────────────┐
│  浏览器 (Chrome/Edge)                                               │
│  http://localhost:5006                                              │
│  - SPA：Vite 构建产物（dist），nginx 静态伺服                      │
│  - Vue 3 + Element Plus + vis-network + neo4j-driver（BOLT）       │
└────────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                                       ▼
┌──────────────────┐                   ┌─────────────────────────┐
│ webviz (nginx)    │                   │ Neo4j Browser          │
│ - SPA 静态服务    │                   │ http://7474            │
│ - /kb/<ws>/__parsed__/*.md 原文     │ (数据运维工具)            │
│ - /llm/ 反代到 SiliconFlow（仅前端）│                           │
└──────────────────┘                   └─────────────────────────┘
        │                                       ▲
        │ Bolt 直连（neo4j-driver）              │ HTTP API
        ▼                                       │
┌──────────────────────────────────────────────────────────┐
│ Neo4j-display（展示版，已清理）   ◄─── 复制/同步 ───►  Neo4j（完整版）│
│ bolt://7688                          bolt://7687           │
│ 浏览器 / webviz 专用                                LightRAG 写入 │
│ 端口 7475                                             端口 7474   │
└──────────────────────────────────────────────────────────┘
                ▲                                                  ▲
                │ BOLT                                             │
                │ （前端浏览器 → webviz → neo4j-display）           │
                │                                                  │
        ┌───────┴───────┐                              ┌─────────┴────────┐
        │ LightRAG 实例 │                              │ PostgreSQL       │
        │ (7 个容器实例)│                              │ (KV / DocStatus) │
        │ :9621 总图    │─────── HTTP ─────────────►   │                  │
        │ :9622 g01     │                              │                  │
        │ :9623 g02     │                              │                  │
        │ ...           │                              │                  │
        │ :9627 g06     │                              │                  │
        └───────┬───────┘                              └──────────────────┘
                │ BOLT / HTTP / gRPC
                ▼
        ┌───────────────────────────────────────────────┐
        │ Qdrant 向量库（chunk 集合命名按 ws 隔离）     │
        │ :6333 (Dashboard) / :6334 gRPC               │
        └───────────────────────────────────────────────┘
```

## 组件职责

| 组件 | 职责 | 配置入口 |
|------|------|---------|
| **Neo4j (完整版)** | LightRAG 抽取的实体与关系**写入**这里（Neo4JStorage）。 | `docker-compose.yml` service `neo4j`、卷 `neo4j_data` |
| **Neo4j-display (展示版)** | 从完整版导出 → 跑 `clean/prune/kcore/merge` 清理 → 浏览器直连 | `scripts/graph/*` |
| **Qdrant** | chunk 向量检索（按 ws 独立集合） | service `qdrant`、卷 `qdrant_data` |
| **PostgreSQL** | LightRAG 的 KV 状态、文档状态、任务队列 | `pgvector/pgvector:pg16` |
| **LightRAG (总图)** | 端口 9621、`WORKSPACE=g00_master_all`，默认随基础设施启动 | `docker-compose.yml` service `lightrag` |
| **LightRAG (分图 g01~g06)** | 端口 9622-9627，`profile=subgraphs`，按需启动 | `docker-compose.yml` services `lightrag-g01~g06` |
| **pgAdmin** | PostgreSQL Web 管理 | `dpage/pgadmin4:latest`、端口 5050 |
| **webviz (nginx)** | 静态前端 + `/kb/` 原文 + `/llm/` 反代 | `nginx/*.conf`、端口 5006 |

## 数据流

### 索引流程（一次性 / 增量）

```
原始资料 (data/inputs/_origin/*.html|pdf|...)
   ↓  scripts/ops/build_origins.py 生成 _origin_manifest.json
   ↓  build_origins.py 解析（html2text / pdf2txt）→ data/inputs/<ws>/__parsed__/*.md
   ↓  scripts/ops/ingest-graphs.ps1（PowerShell）：
        docker compose exec lightrag /lightrag-ingest --workspace g00_master_all
   ↓  LightRAG 用 ENTITY_TYPE_PROMPT_FILE（lychee_culture.yml）做 JSON 结构化抽取
   ↓  实体 / 关系 → Neo4j (节点标签 = ws，标签属性 = entity_type)
       chunk + 向量 → Qdrant (collection = lightrag_vdb_chunks_baai_bge_m3_1024d)
       KV / DocStatus → PostgreSQL
```

### 查询流程

```
用户在前端输入问题
   ↓  POST /query/stream  →  lightrag 实例 :9621
   ↓  LightRAG：Qdrant 向量检索 top_k → Neo4j 图扩展 → LLM 生成
   ↓  NDJSON 流式返回（{references:[...]} 先发 + {response:"<delta>"} 逐字）
   ↓  前端 streamRag() 解析 → aiMsg.html 实时刷新 + mdToHtml 渲染
   ↓  用户悬停 [n] → 弹悬浮气泡；点击 → openOriginal(file_path) → 浏览器打开原网页
```

## 工作区隔离策略

LightRAG 一份实例只支持**一个** `WORKSPACE`。本项目通过 **同存储隔离 + 多实例并存**：

| 维度 | 隔离机制 |
|------|---------|
| Neo4j 实体标签 | 节点 `Label = <ws>`（如 `g03_varieties`）；查询 `MATCH (n:g03_varieties)` |
| Qdrant 向量集合 | collection 名 = `lightrag_vdb_chunks_baai_bge_m3_1024d`（LightRAG 内置按 ws 分隔） |
| PostgreSQL KV | `workspace` 列 |
| 端口 | 9621~9627 各对应一个实例 |

这样"一套数据库 + 7 个容器实例"即可同时存在 1 张总图 + 6 张专题子图，互不串扰。

## 端口规划

| 端口 | 服务 | 备注 |
|------|------|------|
| 5006 | webviz (前端) | 用户入口 |
| 5050 | pgAdmin | PostgreSQL 管理 |
| 5432 | PostgreSQL | LightRAG + pgAdmin |
| 6333 | Qdrant Dashboard | 向量库管理 |
| 7474 | Neo4j Browser (完整版) | 运维 |
| 7475 | Neo4j Browser (展示版) | 验证 |
| 7687 | Neo4j Bolt (完整版) | LightRAG 写入 |
| 7688 | Neo4j Bolt (展示版) | 浏览器直连 |
| 9621 | LightRAG 总图 | 默认启动 |
| 9622-9627 | LightRAG 分图 g01-g06 | profile=subgraphs |

## 文件落点对照

| 关注点 | 文件 / 目录 |
|--------|-----------|
| 改服务编排 | `docker-compose.yml` |
| 改环境变量 | `.env`（不入 git）+ `.env.example`（模板） |
| 改存储后端 | `.env` 里 `LIGHTRAG_*_STORAGE` |
| 改前端 UI | `frontend/src/views/*.vue` + `frontend/src/styles/main.css` |
| 改领域抽取 | `data/prompts/entity_type/*.yml` |
| 加新子图 | 复制 `docker-compose.yml` 里 `lightrag-g01` 一段改 WORKSPACE |
| 跑图谱清理 | `scripts/graph/*.py` |
| 看构建日志 | `logs/`（不入 git） |
| 错误排查 | [docs/05-troubleshooting.md](05-troubleshooting.md) |
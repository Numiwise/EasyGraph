# LightRAG · 知识图谱问答（Multi-Workspace Demo）

> 一个用 [LightRAG](https://github.com/HKUDS/LightRAG) + Neo4j + Qdrant + PostgreSQL 搭建的
> **「7 个工作区 = 1 张总图 + 6 张专题子图」** 的知识图谱可视化与 AI 问答系统。
> 前端是一个无构建依赖的 Vue 3 应用（浏览器直连 Neo4j BOLT）。

---

## 项目亮点

- **多工作区并行**：单套数据库 + 7 个 LightRAG 实例（一个总图 + 6 个专题子图），互不串扰。
- **生产级存储栈**：Neo4j（图）+ Qdrant（向量）+ PostgreSQL（KV / DocStatus），可水平扩展。
- **领域定制抽取**：内置 `lychee_culture.yml`（15 种实体类型 + 关系词典 + 抽取准则），JSON 结构化抽取质量更高。
- **零构建前端**：Vue 3 + Element Plus + vis-network（CDN/本地），打开即用，无 webpack/vite 依赖。
- **完整溯源**：回答中的 `[n]` 引用 → 弹出原文段落 → 点开跳转原网页（HTML/PDF/PNG 直接由浏览器渲染）。
- **左侧历史会话**：复用 ChatGPT 抽屉交互，多会话隔离，按工作区存于浏览器本地。

---

## 5 分钟快速开始

> 假设环境：Linux / macOS / WSL2，已安装 Docker ≥ 24 + Docker Compose v2。Windows 用户推荐 WSL2。

### 1. 克隆与配置

```bash
git clone <your-repo>
cd lightrag-deploy
cp .env.example .env
# 编辑 .env，至少填入你的 LLM_BINDING_API_KEY 与 NEO4J_PASSWORD / POSTGRES_PASSWORD
```

### 2. 一键启动基础设施 + 总图实例

```bash
docker compose up -d neo4j qdrant postgres webviz lightrag
```

等待约 30-60 秒（Neo4j 首次启动较慢），检查服务状态：

```bash
docker compose ps
# neo4j/qdrant/postgres/lightrag/webviz 都应是 Up(healthy) 或 Up
```

### 3. 打开 Web UI

| 入口 | URL |
|------|------|
| **前端首页 + 图谱浏览** | http://localhost:5006 |
| **Neo4j Browser**（管理图） | http://localhost:7474 （用户 `neo4j`，密码见 `.env`） |
| **Qdrant Dashboard** | http://localhost:6333/dashboard |
| **pgAdmin**（PG 可视化） | http://localhost:5050 |

打开 `http://localhost:5006`：

- 点击「总图谱」/ 任一专题卡 → 在 Neo4j 上浏览关系网络（实体类型筛选 + 节点详情 + 原文溯源）
- 顶部「向 AI 提问」 → 选子图 → 输入问题 → 流式回答 + 行内 `[n]` 引用 + 鼠标悬停弹原文段落

### 4. （可选）启动 6 个专题子图实例

```bash
docker compose --profile subgraphs up -d
```

6 个 LightRAG 实例各占 9622-9627 端口，按需启动。`scripts/ops/switch-graph.ps1` 提供 Windows 下的便捷切换脚本。

### 5. 跑测试

```bash
pip install -r requirements.txt
python -m pytest tests/ -v
```

`tests/` 包含 **烟雾测试**（不依赖运行中的服务，验证脚本 / 配置 / CSS / Nginx / 索引完整性）。

---

## 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│  浏览器 (Chrome/Edge)                                               │
│  http://localhost:5006                                              │
└────────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                                       ▼
┌──────────────────┐                   ┌─────────────────────────┐
│ webviz (nginx)    │                   │ Neo4j Browser          │
│ 静态前端 SPA      │                   │ http://7474            │
│ + /kb/ 原文目录   │                   └─────────────────────────┘
└──────────────────┘
        │                       │
        │ Bolt 直连            │ HTTP API
        ▼                       ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ neo4j-display     │    │ Neo4j (完整版)    │    │ Qdrant           │
│ (展示版，清理后)  │◄───│ (LightRAG 写入)  │    │ (向量检索)       │
│ bolt://7688       │    │ bolt://7687       │    │ :6333          │
│ 浏览器直连        │    └──────────────────┘    └──────────────────┘
└──────────────────┘              ▲                       ▲
                                  │                       │
                          ┌───────┴───────┐       ┌───────┴───────┐
                          │ LightRAG 实例  │       │ PostgreSQL    │
                          │ (7 个 WS)      │       │ (KV / DocStatus)│
                          │ 9621~9627      │       │ 5432           │
                          └───────────────┘       └───────────────┘
```

完整架构、数据流、组件边界详见 [`docs/01-architecture.md`](docs/01-architecture.md)。

---

## 目录结构（专业布局）

```
lightrag-deploy/
├── README.md                 ← 你正在看
├── docker-compose.yml        ← Docker 编排（neo4j / qdrant / pg / 7×LightRAG / webviz / pgAdmin）
├── .env.example              ← 配置模板（不含真实密钥）
├── .gitignore
├── requirements.txt          ← 本地脚本与测试依赖
│
├── data/                     ← 业务数据 + Prompt
│   ├── inputs/               ← 原始资料 + 已解析 markdown（按 ws 分目录）+ _origin_manifest.json
│   ├── prompts/entity_type/   ← 领域定制 yml
│   └── lightrag_overrides/    ← 已回滚（见 README.md 注释）
│
├── scripts/
│   ├── ops/                  ← docker / nginx / 教学侧运维脚本（ingest-graphs/switch-graph）
│   ├── graph/                ← 图谱清洗/分析（clean/prune/merge/analyze）
│   ├── tests/                ← 早期手写测试脚本（需运行中的服务）
│   └── patch_lightrag_prompt.py
│
├── nginx/                    ← nginx 配置（webviz 主配置 + 反向代理）
│   ├── nginx-main.conf
│   └── nginx-webviz.conf
│
├── frontend/                 ← Vue 3 + Element Plus + vis-network（无构建）
│   ├── index.html
│   ├── vendor/               ← 本地化的 vue / element-plus / vis-network / neo4j-web
│   └── src/
│       ├── api/              ← lightrag.js / neo4j.js（HTTP/Bolt 客户端）
│       ├── views/            ← HomeView / GraphView / QueryView / DocView
│       ├── styles/           ← main.css（全局+共享） + home/graph/query/doc.css（各 view 专属）
│       └── router.js
│
├── tests/                    ← pytest 测试（不依赖 Docker 服务）
│   ├── conftest.py
│   ├── test_smoke.py
│   └── test_data/            ← 测试 fixture
│
├── docs/                     ← 公开教程（GitHub 上可访问）
│   ├── 00-quickstart.md      ← 5 分钟上手（本 README 的展开版）
│   ├── 01-architecture.md    ← 系统设计、模块依赖、数据流
│   ├── 02-deploy.md          ← 详细部署、环境变量、调优
│   ├── 03-usage.md           ← 使用指南（前端各页 + 搜索 + 引用溯源）
│   ├── 04-customization.md   ← 如何换数据 / 改 Prompt / 扩图谱
│   ├── 05-troubleshooting.md ← 故障排查与常见错误
│   ├── CHANGELOG.md          ← 版本演进
│   └── assets/               ← 文档配图
│
└── _private/                 ← 私有材料（不入 git；见 .gitignore）
    └── 课程方案.md             ← 配套课程教案（仅项目内部）
```

---

## 自定义与扩展

- **换自己的数据**：把 `data/inputs/_origin/` 下的原始资料换成你的，清空已 parse 的 `data/inputs/<ws>/__parsed__/`，
  重新跑 `scripts/ops/ingest-graphs.ps1`。
- **换实体类型**：编辑 `data/prompts/entity_type/*.yml`（仿照 `lychee_culture.yml` 写一份你领域的 Schema）。
- **扩图谱**：在 `docker-compose.yml` 复制 `lightrag-g01` 一个新实例，改 `WORKSPACE` 和 `ENTITY_TYPE_PROMPT_FILE`。
- **改前端样式**：CSS 已拆分到 `frontend/src/styles/{main,home,graph,query,doc}.css`，各 view 一目了然。

详见 [`docs/04-customization.md`](docs/04-customization.md)。

---

## 测试

- **烟雾测试**（推荐先跑）：`python -m pytest tests/` —— 不依赖 Docker 服务，验证项目结构完整性。
- **端到端测试**（需服务运行）：`python scripts/tests/test_lightrag_stream.py` 等。
- **图谱健康度**：`python scripts/graph/analyze_graph.py`。

---

## 文档导航

- 快速开始 → [`docs/00-quickstart.md`](docs/00-quickstart.md)
- 架构详解 → [`docs/01-architecture.md`](docs/01-architecture.md)
- 详细部署 → [`docs/02-deploy.md`](docs/02-deploy.md)
- 使用指南 → [`docs/03-usage.md`](docs/03-usage.md)
- 定制 / 扩展 → [`docs/04-customization.md`](docs/04-customization.md)
- 故障排查 → [`docs/05-troubleshooting.md`](docs/05-troubleshooting.md)
- 版本日志 → [`docs/CHANGELOG.md`](docs/CHANGELOG.md)

---

## 技术栈

| 层 | 技术 |
|----|------|
| RAG 框架 | [LightRAG](https://github.com/HKUDS/LightRAG) v1.5.6（官方 ghcr 镜像） |
| LLM | OpenAI 兼容协议（默认 SiliconFlow，可换 DeepSeek/OpenAI/智谱等） |
| Embedding | BAAI/bge-m3（1024 维） |
| 图存储 | Neo4j 5.26 |
| 向量库 | Qdrant latest |
| KV / 文档状态 | PostgreSQL 16 + pgvector |
| 前端 | Vue 3 + Element Plus + vis-network + neo4j-driver（Vite 构建） |
| 反向代理 | nginx:alpine |
| 数据库可视化 | pgAdmin（PG） |

---

## License

MIT — 详见 [LICENSE](LICENSE)。课程教学相关材料在 `_private/` 下，不随仓库发布。

---

## 致谢

- [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) — 核心 RAG 框架
- [SiliconFlow](https://siliconflow.cn/) — 默认 LLM/Embedding 提供方
- 课程配套人工智能课（详见 `_private/`）
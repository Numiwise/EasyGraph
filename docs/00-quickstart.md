# 5 分钟快速开始

> 这是 [README.md](../README.md) 的展开版：逐步命令、可复制粘贴、踩坑预警。

## 0. 前置要求

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Docker | 24.0+ | 运行所有服务 |
| Docker Compose | v2 (内置 docker compose) | 编排 |
| Git | 任意 | 克隆仓库（可选） |
| Python | 3.10+ | 跑测试 / 图谱脚本 |
| 一个 OpenAI 兼容 LLM 服务 | — | 推荐 [SiliconFlow](https://siliconflow.cn/) 通用 LLM + Embedding |

> **不需要**：Node.js、npm、webpack、vite。前端是纯静态 HTML/JS，nginx 直接伺服。

## 1. 克隆与配置

```bash
git clone https://github.com/<your-org>/easygraph.git
cd easygraph
cp .env.example .env
```

编辑 `.env`，至少修改这三处：

```bash
LLM_BINDING_API_KEY=sk-你的key         # LLM
EMBEDDING_BINDING_API_KEY=sk-你的key  # Embedding（可与上面相同）
NEO4J_PASSWORD=你的密码
POSTGRES_PASSWORD=你的密码
PGADMIN_PASSWORD=你的密码
```

> 不改也能启动，但用示例 key 会被服务商拒绝。

## 2. 启动基础设施 + 总图实例

```bash
docker compose up -d neo4j qdrant postgres webviz lightrag
```

5 个核心服务。Neo4j 第一次启动会下拉约 600MB 镜像，约 30-60s。

`docker compose ps` 应显示所有服务状态 `Up(healthy)`：

```text
NAME                 STATUS
lightrag-neo4j       Up (healthy)
lightrag-qdrant      Up (healthy)
lightrag-postgres    Up (healthy)
lightrag-server      Up
lightrag-webviz      Up
```

## 3. 打开 Web UI

| 入口 | URL |
|------|------|
| **前端首页 + 图谱 + AI 问答** | http://localhost:5006 |
| Neo4j Browser | http://localhost:7474 |
| Qdrant Dashboard | http://localhost:6333/dashboard |
| pgAdmin | http://localhost:5050 |

### 浏览器直连 Neo4j：webviz

打开 `http://localhost:5006` 会看到首页 7 张图谱卡片。
点任一卡片 → 浏览器直连 `bolt://localhost:7688`（展示版 Neo4j），渲染关系网络。

### AI 问答

顶部「向 AI 提问」按钮 → 选子图（默认 `g00_master_all` 总图） → 输入问题。
回答会**流式**渲染，回答中的 `[n]` 引用鼠标悬停可看原文段落，点击数字可打开原网页。

## 4. （可选）启动 6 个专题子图

默认只跑总图实例（端口 9621）。专题子图实例在 `profile=subgraphs` 下，按需启动：

```bash
docker compose --profile subgraphs up -d
```

各专题对应端口 9622-9627。`scripts/ops/switch-graph.ps1`（Windows）/ `switch-graph.sh`（POSIX，待补充）可一键切换。

> **关于性能**：每个 LightRAG 实例占用 ~500MB 内存。6 个专题实例全跑 ≈ 3GB 额外内存，**按需启动**是设计目标。

## 5. 跑测试

```bash
pip install -r requirements.txt
python -m pytest tests/ -v
```

应看到所有测试通过（不依赖 Docker 服务）。

---

## 下一步

- 想了解系统设计？→ [docs/01-architecture.md](01-architecture.md)
- 想换数据 / 改 Prompt？→ [docs/04-customization.md](04-customization.md)
- 遇到错误？→ [docs/05-troubleshooting.md](05-troubleshooting.md)
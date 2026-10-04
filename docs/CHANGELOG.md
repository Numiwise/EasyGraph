# 更新日志

## v2.2.0 — 2026-10-04

**项目正式更名为 EasyGraph，确立中文品牌名「EasyGraph 智能知识图谱构建与问答工具」。**

主要变更：

### 项目
- 应用名由 `lightrag-deploy` / `lightrag-visualize` 正式更名为 **EasyGraph**
- 中文官方名：**EasyGraph 智能知识图谱构建与问答工具**
- Gitee 仓库 `numiwise/lightrag-visualize` 已重命名为 `numiwise/easygraph`
- Docker Compose 项目名显式指定 `name: easygraph`，数据卷前缀从 `lightrag-deploy_*` 改为 `easygraph_*`
- 前端 `package.json` name 改为 `easygraph-webviz`，version 升至 2.2.0
- 浏览器标签页标题改为 "EasyGraph · 智能知识图谱构建与问答工具"
- README / quickstart / architecture / deploy / CHANGELOG / cloud-setup.sh 顶层品牌名 + 中文官方名统一

### 不变项（确保兼容）
- 底层 RAG 框架仍为 [LightRAG](https://github.com/HKUDS/LightRAG) v1.5.6（保留所有 `lightrag-*` 容器名、`/lightrag/*` API 路径、LightRAG 镜像拉取）
- Neo4j 实体数据 / Qdrant collection / Postgres KV / 已抽取的 7 个 workspace 全部兼容，无需重抽

---

## v2.1.0 — 2026-09-30

**7 workspace 抽取完成 + 展示端剪裁。**

主要变更：
- 总图 + 6 个专题子图全部抽取完成（0 fail、168 文件）
- 显示端 Neo4j (`neo4j-display`) 通过 dump/load + clean_graph + merge_aliases 完成剪裁
- 修复前端 AI 提问中文提示词（user_prompt 覆盖 LightRAG 默认英文 prompt）
- gitee 仓库首次推送，SSH ed25519 认证通过
- 腾讯云 CVM Docker 环境就绪

---

## v1.0.0 — 2026-09-23

**首次对外发布。**

主要变更：

### 内容
- 1 张总图（g00_master_all）+ 6 张专题子图（g01~g06），覆盖人物、文献、地点、交通、品种、历史、制度、岭南文化、荔湾、现代产业共 10 个领域
- 约 80 个核心实体 + 数百条关系
- 全部基于公开素材（人民网、新华网、中新网、南方+、广东省林业局、广州市政府等）

### 工程
- 多工作区并行架构（1 套数据库 + 7 个 LightRAG 实例）
- 生产级存储栈：Neo4j + Qdrant + PostgreSQL
- 领域定制抽取：`lychee_culture.yml`（15 实体类型 + 关系词典 + 抽取准则 + few-shot）
- 零构建前端（Vue 3 + Element Plus + vis-network，nginx 直接伺服）
- 完整溯源链路（行内 `[n]` 引用 → 原文段落 → 原网页）
- 左侧历史会话抽屉（ChatGPT 式）
- 引用悬浮气泡（450ms 缓冲 + 离开弹窗即消失）

### 文档
- 完整 README + 6 篇教程（快速开始 / 架构 / 部署 / 使用 / 定制 / 故障排查）
- 项目级烟雾测试（pytest）
- 旧手写测试脚本迁到 `scripts/tests/`

### 存储
- 双 Neo4j 实例（完整版写入 + 展示版清理后供前端）
- 反向代理保护 LLM key（nginx `/llm/`）
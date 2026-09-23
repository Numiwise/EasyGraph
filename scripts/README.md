# Scripts 说明

## 目录结构

```
scripts/
├── ops/                       ← Docker / nginx / 教学侧运维脚本
│   ├── build_origins.py       ← 遍历 _origin/ 解析 → __parsed__/ + 生成 _origin_manifest.json
│   ├── ingest-graphs.ps1      ← Windows: 一键入 7 个工作区
│   ├── ingest-parallel.ps1    ← Windows: 并行 ingest 6 个分图（加速）
│   ├── switch-graph.ps1       ← Windows: 切换当前激活的 LightRAG 实例（用于 port forwarding）
│   ├── nginx-main.conf         ← 见 nginx/
│   └── nginx-webviz.conf       ← 见 nginx/
│
├── graph/                     ← 图谱清洗与分析
│   ├── clean_graph.py          ← 类型白名单 + 孤立点删减
│   ├── merge_aliases.py        ← 同义合并（如「长安」=「京兆府」）
│   ├── prune_graph.py          ← 通用修剪
│   ├── prune_kcore.py          ← 2-core 修剪（去弱邻居）
│   ├── prune_marginal.py       ← 边缘节点修剪
│   ├── remove_english.py       ← 移除英文节点（保留中文为主）
│   └── analyze_graph.py        ← 度数分布 / 连通分量 / 实体类型统计
│
├── tests/                     ← 早期手写测试（需运行中的 Docker 服务）
│   ├── test_422_payload.py          ← LightRAG /query 422 触发条件
│   ├── test_422_v2_triggers.py      ← 422 v2
│   ├── test_lightrag_stream.py      ← /query/stream 完整流式响应
│   ├── test_lightrag_stream_full.py
│   ├── test_proxy_direct.py         ← nginx /llm/ 反代直连
│   ├── test_proxy_stream.py        ← nginx /llm/ 流式
│   ├── test_sf_sdk.py               ← SiliconFlow SDK 直接调用
│   └── repro_frontend_body.py       ← 复现前端请求体
│
└── patch_lightrag_prompt.py    ← 已回滚（保留以供参考）；切勿再启用，避免 422
```

## 运行测试（推荐 pytest 烟雾测试先跑）

```bash
# 烟雾测试（不依赖 Docker）
pip install -r requirements.txt
python -m pytest tests/ -v

# 端到端（需要 LightRAG 实例在跑）
python scripts/tests/test_lightrag_stream.py
```

## 运维脚本使用

### 首次入数据（端到端）

```bash
# 1) 准备原始资料 → data/inputs/_origin/
# 2) 解析为 markdown（带 manifest）
python scripts/ops/build_origins.py

# 3) 一键入 7 个工作区（Windows PowerShell）
pwsh scripts/ops/ingest-graphs.ps1
```

### 图谱清理（建立展示版）

Neo4j-display 容器跑：

```bash
docker compose exec neo4j-display bash
python /scripts/clean_graph.py
python /scripts/merge_aliases.py
python /scripts/prune_kcore.py
```

## 添加自定义脚本

新脚本放对应子目录，顶部加 docstring 注明用途 + 用法。在本 README 加一行说明。
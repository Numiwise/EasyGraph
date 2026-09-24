#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
config.py —— api_bridge 后端网关的配置读取
==================================================================
业务用途：
    本模块只有一个职责：从「环境变量」读取数据库连接、Qdrant 地址、
    以及 bridge 共享 token，并暴露给包内其它模块使用。
    **绝不在代码里写死真实的密码或 token**。
    这样前端拿不到、代码提交也不会泄露 —— 真实值都在 docker compose 的
    environment（源自 .env）里。

设计要点（给读者）：
    - 用 os.environ.get(键, 默认值) 读取；默认值仅用于本地/兜底，不是真实 secret。
    - NEO4J_PASSWORD / BRIDGE_TOKEN 不给默认值（空串），安全失败
      （连不上会报认证错误而非带错密码；token 缺失会让所有 /api/ 返回 401）。
    - 端口/服务名都是 compose 内部网络的服务名（如 bolt://neo4j-display:7687），
      而不是宿主机 localhost —— 因为本服务作为容器运行在 compose 网络里。
==================================================================
"""
import os

# ============================================================
# Neo4j 展示库（可视化用，GraphView / HomeView 的数据来源）
# ------------------------------------------------------------
# 服务名：docker compose 里 `neo4j-display` 服务，容器间用服务名互访。
# 如果本机直接跑（非容器），可设环境变量 NEO4J_URI 指向 bolt://localhost:7688。
# ============================================================
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://neo4j-display:7687")
# Neo4j 用户名（默认 neo4j）
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
# Neo4j 密码：**必须**由环境变量提供（docker compose 从 .env 注入），不留默认值。
# 这样即使有人拿到代码，也不知道密码；没配就直接认证失败，安全失败。
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")

# ============================================================
# Qdrant（原文 chunk 向量库）
# ------------------------------------------------------------
# 服务名：docker compose 里 `qdrant` 服务，容器间用服务名互访。
# ============================================================
QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
# Qdrant 里存放「原文段落」的 collection 名（与 LightRAG 默认命名一致）
QDRANT_CHUNK_COLLECTION = "lightrag_vdb_chunks_baai_bge_m3_1024d"

# ============================================================
# Bridge Token（前后端共享的"内部"口令）
# ------------------------------------------------------------
# 业务背景：
#   api-bridge 只接受来自 webviz/nginx 的请求（不可能来自浏览器 JS，
#   因为浏览器只 fetch /api/ 同源路径，由 nginx 反代时注入此 token）。
#   这样即使 webviz:5006 暴露到公网，恶意用户也无法直接 curl 9630 端口
#   绕过 token 抓走所有图谱数据。
#
# 安全要求：
#   - 必须由环境变量提供（不留默认值，否则等于"无密码"）。
#   - docker compose webviz / api-bridge 两边都注入同一份 BRIDGE_TOKEN。
#   - nginx 反代时把 token 写到 X-Bridge-Token 头传给后端。
# ============================================================
BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
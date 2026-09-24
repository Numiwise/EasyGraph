#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
main.py —— api_bridge 后端网关的 FastAPI 入口（路由挂载）
==================================================================
业务用途：
    把 queries.py / qdrant.py 里的只读查询函数挂成 HTTP 端点，供前端通过
    同源 /api/* 调用。前端浏览器只 fetch /api/*（经 webviz 的 nginx 反代到本服务），
    数据库连接信息完全藏在后端。

启动（docker compose 的 api-bridge 服务执行）：
    uvicorn scripts.api_bridge.main:app --host 0.0.0.0 --port 9630

端点一览（全部 GET，只读）：
    /api/counts                    每个 workspace 的节点/关系数（首页统计）
    /api/types?ws=                 workspace 的 entity_type 列表（图例）
    /api/graph?ws=&limit=&types=   全图核心节点+关系
    /api/search?ws=&kw=&hops=&cap=&types=   名称搜索 + k 跳展开
    /api/expand?ws=&id=&hops=&types=        以某节点为中心 k 跳展开
    /api/node?ws=&name=            单节点属性
    /api/chunk?id=&ws=             从 Qdrant 取原文片段

CORS：
    生产环境前端和本服务同源（都经 webviz 的 nginx，/api/ 反代到 9630），
    不需要 CORS。这里仍允许开发态 Vite(5173) 直连，方便本地联调。
==================================================================
"""
from typing import List, Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from . import queries, qdrant

app = FastAPI(title="lightrag-db-bridge", version="1.0")

# 开发态 CORS：仅允许 Vite dev server（生产走 nginx 同源，不需要）。
# 生产可收紧为同源或干脆去掉。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/counts")
def api_counts():
    """首页三连数字：每个 workspace 的节点/关系数。"""
    return queries.counts_all()


@app.get("/api/types")
def api_types(ws: str = Query(...)):
    """图例：某 workspace 的 entity_type 列表。"""
    return {"types": queries.list_types(ws)}


@app.get("/api/graph")
def api_graph(ws: str = Query(...), limit: int = Query(300), types: str = Query("")):
    """全图核心节点+关系。types 为逗号分隔白名单（空=不过滤）。"""
    return queries.full_graph(ws, limit=limit, types=types)


@app.get("/api/search")
def api_search(ws: str = Query(...), kw: str = Query(""), hops: int = Query(1),
               cap: int = Query(300), types: str = Query("")):
    """名称搜索 + k 跳展开。"""
    return queries.search_graph(ws, kw=kw, hops=hops, cap=cap, types=types)


@app.get("/api/expand")
def api_expand(ws: str = Query(...), id: int = Query(...), hops: int = Query(1),
               types: str = Query("")):
    """以某节点 ID 为中心 k 跳展开。"""
    return queries.expand_graph(ws, node_id=id, hops=hops, types=types)


@app.get("/api/node")
def api_node(ws: str = Query(...), name: str = Query(...)):
    """单节点属性（右侧详情）。"""
    return queries.node_props(ws, name)


@app.get("/api/chunk")
def api_chunk(id: str = Query(...), ws: str = Query(...)):
    """从 Qdrant 取原文 chunk。"""
    return qdrant.chunk(id, ws)

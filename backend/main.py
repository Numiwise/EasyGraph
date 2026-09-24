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
    uvicorn backend.main:app --host 0.0.0.0 --port 9630

端点一览（全部 GET，只读）：
    /api/counts                    每个 workspace 的节点/关系数（首页统计）
    /api/types?ws=                 workspace 的 entity_type 列表（图例）
    /api/graph?ws=&limit=&types=   全图核心节点+关系
    /api/search?ws=&kw=&hops=&cap=&types=   名称搜索 + k 跳展开
    /api/expand?ws=&id=&hops=&types=        以某节点为中心 k 跳展开
    /api/node?ws=&name=            单节点属性
    /api/chunk?id=&ws=             从 Qdrant 取原文片段

鉴权（重要！）：
    api-bridge 不接受任何浏览器直接请求（端口 9630 仅绑定 127.0.0.1，
    宿主机外网根本到不了）。但容器内 nginx 会通过同源 /api/ 反代到本服务，
    所以我们在每一个端点上校验 X-Bridge-Token 头：
      - 头缺失 / 值错 / 空 token 配置 → 直接 401 返回，不进入业务逻辑。
      - nginx 在 location /api/ 段把这个头从容器环境变量注入，浏览器 JS
        永远拿不到真 token。
    这样即使有人绕过 nginx 直接访问 9630 端口，或某天误把 api-bridge
    端口暴露到公网，数据也不会被偷走。

CORS：
    生产环境前端和本服务同源（都经 webviz 的 nginx，/api/ 反代到 9630），
    不需要 CORS。这里仍允许开发态 Vite(5173) 直连，方便本地联调。
==================================================================
"""
import hmac

from typing import Optional

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import queries, qdrant
from .config import BRIDGE_TOKEN

app = FastAPI(title="lightrag-db-bridge", version="1.0")

# 开发态 CORS：仅允许 Vite dev server（生产走 nginx 同源，不需要）。
# 生产可收紧为同源或干脆去掉。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ============================================================
# Token 鉴权依赖
# ------------------------------------------------------------
# 实现要点（给读者）：
#   - 用 hmac.compare_digest 做常量时间比较，避免时序攻击泄露 token 长度。
#   - BRIDGE_TOKEN 为空时直接拒绝所有请求（开发态可临时设 BRIDGE_TOKEN=dev
#     让本地联调不报错，但默认配置不允许）。
#   - 用 Request 而非 Header(...) 自动依赖：方便在异常分支自己构造响应，
#     也能让 /docs 等 FastAPI 自带端点不被错误拦截（这里不挂 swagger）。
# ============================================================
def _check_token(request: Request) -> Optional[JSONResponse]:
    """校验 X-Bridge-Token；返回 None 表示通过，返回 JSONResponse 表示拒绝。"""
    if not BRIDGE_TOKEN:
        # 配置缺失 → 直接拒绝，安全失败（运维层会被迫发现这个错误）
        return JSONResponse(
            {"error": "BRIDGE_TOKEN 未配置"},
            status_code=503
        )
    # 从 header 取 token；前端请求永远带不上这个头（浏览器代理点不动 server header）
    supplied = request.headers.get("X-Bridge-Token", "")
    # 常量时间比较：避免攻击者通过响应耗时推断 token 内容
    if not hmac.compare_digest(supplied, BRIDGE_TOKEN):
        return JSONResponse(
            {"error": "Unauthorized"},
            status_code=401
        )
    return None


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """对所有 /api/* 请求统一拦截 token，无 token 的 401 不进入业务逻辑。"""
    # 只对 /api/* 路径生效；其他（如 /health、FastAPI 自带）放行（目前没有其它路径）
    if request.url.path.startswith("/api/"):
        denied = _check_token(request)
        if denied is not None:
            return denied
    return await call_next(request)


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
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qdrant.py —— Qdrant 原文 chunk 的只读查询
==================================================================
业务用途：
    原来前端 useLightragApi.js 里的 fetchChunk 是浏览器直连 Qdrant(http://6333) 取原文段落。
    现在由本模块在后端统一代理：前端只要调 /api/chunk，后端再用 httpx 去 Qdrant
    取数据。这样前端不再暴露 Qdrant 的地址与端口，也统一走同源 /api。

设计要点（给读者）：
    - 用的是 Qdrant 的 Scroll API（POST /collections/{name}/points/scroll），
      通过 filter（must 且）按 chunk id + workspace_id 精确匹配。
    - with_payload=True / with_vector=False：只要 payload（含 content 原文），不要向量。
    - 失败返回 {"payload": None, "error": ...}，让前端能降级处理（显示"未检索到"）。
==================================================================
"""
import httpx

from .config import QDRANT_URL, QDRANT_CHUNK_COLLECTION
from .db import _sanitize


def chunk(id: str, ws: str):
    """按 chunk id + workspace 消歧，从 Qdrant 取该片段的 payload。

    参数：
        id ：chunk 的 id（LightRAG 生成）
        ws ：workspace id，用于过滤消歧（不同工作区可能有相似 id）
    返回：
        {"payload": {...}} 或 {"payload": None, "error": "..."}
    """
    url = f"{QDRANT_URL}/collections/{QDRANT_CHUNK_COLLECTION}/points/scroll"
    body = {
        # filter.must 是「且」关系：id 命中且 workspace_id 命中
        "filter": {
            "must": [
                {"key": "id", "match": {"value": id}},
                {"key": "workspace_id", "match": {"value": ws}},
            ]
        },
        # 即使有重复，最多返回 5 条（通常命中 1 条）
        "limit": 5,
        "with_payload": True,   # 要 payload（含 content 原文）
        "with_vector": False,   # 不要向量本体，省带宽
    }
    try:
        resp = httpx.post(url, json=body, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        pts = (data.get("result") or {}).get("points") or []
        if not pts:
            return {"payload": None}
        # 取第一条的 payload，并做 Neo4j 风格清洗（保险，实际 payload 已是普通 dict）
        return {"payload": _sanitize(pts[0].get("payload") or {})}
    except Exception as exc:
        # 网络/服务错误：返回 None + 错误信息，前端可降级显示
        return {"payload": None, "error": str(exc)}

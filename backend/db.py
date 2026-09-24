#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
db.py —— Neo4j 驱动（单例 + 连接管理）+ Neo4j 返回数据的序列化工具
==================================================================
业务用途：
    后端网关唯一会「直连 Neo4j」的地方。它把 Neo4j 的 Bolt 连接封装成
    一个惰性单例 driver，并提供把查询结果转成「可 JSON 序列化」的工具函数。
    其它模块（queries.py）只管写 Cypher 拿结果，不关心连库细节。

设计要点（给读者）：
    - `neo4j.GraphDatabase.driver(uri, auth=(user, pwd))`：创建 Bolt 驱动。
      它内部维护一个连接池，是一个「重资源」，所以全进程只创建一次（单例）。
    - 惰性初始化：第一次需要时才创建 driver，避免服务启动就强连 Neo4j
      （Neo4j 没起来时也能先启动网关，等它 ready 再连）。
    - _sanitize / _to_int：Neo4j 驱动返回的 int 可能是「内部大整数对象」，
      JSON 序列化会失败，所以统一转成原生 Python 类型。
==================================================================
"""
from neo4j import GraphDatabase

from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

# 模块级单例 driver（惰性创建）。\u200b这里不用 get_driver 外的写法，避免多线程重复创建。
_driver = None


def get_driver():
    """返回 Neo4j 驱动单例（第一次调用时创建）。

    因为是全局共享，多个请求并发用一个连接池，效率高、开销小。
    """
    global _driver
    if _driver is None:
        # Bolt 明文连接（内网开发库），用用户名/密码认证
        _driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    return _driver


def _to_int(v):
    """把可能带 .to_int() 的 Neo4j 大整数统一转成 Python int。

    Neo4j 驱动对大整数返回的对象有两种可能：普通 int，或带 .to_int() 的封装对象。
    这里两种都兼容，转换失败则原样返回（避免抛异常拖垮接口）。
    """
    if v is None:
        return None
    if hasattr(v, "to_int"):
        return v.to_int()
    if hasattr(v, "to_number"):   # 旧版本驱动方法名
        return v.to_number()
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


def _sanitize(value):
    """把 Neo4j 返回的任意属性值转成可 JSON 序列化的 Python 对象。

    需要处理的情况：
      - bool / int / float / str / None    → 直接返回
      - 时空类型（Date/DateTime，有 iso_format）→ 字符串
      - 列表（有 to_list）                 → 逐元素递归
      - 节点 / 关系 / map（有 keys）        → 字典 {k: sanitized}
      - 普通 list / dict                    → 递归

    递归是为了把嵌套结构里的「Neo4j 专属类型」都清干净，保证 FastAPI 能 json.dumps。
    """
    # 基础类型直接过
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    # Neo4j 时空类型（Duration/Date/DateTime...）→ 字符串
    if hasattr(value, "iso_format"):
        try:
            return value.iso_format()
        except Exception:
            return str(value)
    # Neo4j 列表（如 label 列表）→ 转成普通 list
    if hasattr(value, "to_list"):
        return [_sanitize(x) for x in value.to_list()]
    # Neo4j 节点 / 关系 / 映射 → 转成 dict
    if hasattr(value, "keys"):
        return {k: _sanitize(value[k]) for k in value.keys()}
    # 普通容器
    if isinstance(value, (list, tuple)):
        return [_sanitize(x) for x in value]
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    # 兜底：尽力转 int，否则字符串
    try:
        return int(value)
    except Exception:
        return str(value)


def node_record(rec):
    """把一条「节点查询」的返回记录 dict 抽成前端期望的统一节点结构。

    前端 GraphView / radialFetch / expandFromNode 都期望节点长这样：
        { id, name, type, descr, src, fp, props }
    这里把记录的字段一一抽取并做清洗，字段缺失给合理兜底（避免前端 undefined 崩溃）。
    """
    return {
        "id": _to_int(rec.get("id")),
        "name": rec.get("name") or "(未命名)",
        "type": rec.get("type"),
        "descr": rec.get("descr") or "",
        "src": rec.get("src") or "",
        "fp": rec.get("fp") or "",
        "props": _sanitize(rec.get("props") or {}),
    }

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
queries.py —— 图谱「只读」查询逻辑（Neo4j Cypher）
==================================================================
业务用途：
    把原来散在 GraphView / HomeView / QueryView 里、跑在浏览器里的 Cypher，
    统一搬到后端，由 api_bridge 暴露成只读 REST 端点。这样前端不再直连 Neo4j，
    密码/地址不再暴露；并且所有「读」操作都集中在这里，行为与旧版完全一致。

端点对应（供 main.py 挂路由用）：
    counts_all()                → 每个 workspace 的节点/关系数（首页统计）
    list_types(ws)              → workspace 的 entity_type 列表（图例）
    full_graph(ws, limit, types) → 全图核心节点 + 关系（按度数取前 N）
    search_graph(ws, kw, hops, cap, types) → 名称搜索 + k 跳展开
    expand_graph(ws, id, hops, types)      → 以某节点为中心 k 跳展开
    node_props(ws, name)        → 单个节点属性

设计要点（给读者）：
    - 每个函数都「独立开一个 session、用完即关」（短生命周期，避免连接堆积）。
    - Cypher 里的 label（表名）用 f-string 拼，因为 Cypher 不允许参数化 label；
      但 label 是我们自己控制的工作区名（g00_...），无注入风险。
    - entity_type 白名单（types）用列表参数 $typeFs 传，是安全的参数化方式。
==================================================================
"""
from typing import List

from .db import get_driver, node_record, _sanitize, _to_int


def _is_ws_label(label: str) -> bool:
    """判断一个 Neo4j label 是否为「项目工作区标签」。

    工作区命名规则：g + 两位数字 + 下划线（如 g00_master_all / g01_people_literature）。
    用这个过滤掉 Neo4j 自带或其它无关的 label。
    """
    s = str(label)
    return len(s) > 3 and s[0] == "g" and s[1:3].isdigit() and s[3] == "_"


def _parse_types(types: str) -> List[str]:
    """解析前端传来的逗号分隔类型白名单；空串 → 空列表（表示不过滤）。"""
    if not types:
        return []
    return [t.strip() for t in types.split(",") if t.strip()]


def counts_all():
    """统计每个工作区的节点数与关系数（首页三连数字）。

    实现：先取所有 label，过滤出 g{nn}_ 开头的工作区；对每个 label 各跑两条
    MATCH count 语句（数节点、数关系）。
    """
    with get_driver().session() as s:
        res = s.run("CALL db.labels() YIELD label RETURN label ORDER BY label")
        labels = [r["label"] for r in res if _is_ws_label(r["label"])]
        nodes, rels = {}, {}
        for l in labels:
            # 数节点：MATCH 该 label 下所有节点
            nodes[l] = s.run(f"MATCH (n:`{l}`) RETURN count(n) AS c").single()["c"]
            # 数关系：两端都是该 label 的关系（[x] 任意关系类型，双向都算）
            rels[l] = s.run(
                f"MATCH (a:`{l}`)-[x]-(b:`{l}`) RETURN count(x) AS c"
            ).single()["c"]
        # 大整数转原生 int，保证 JSON 可序列化
        return {
            "nodes": {k: _to_int(v) for k, v in nodes.items()},
            "rels": {k: _to_int(v) for k, v in rels.items()},
        }


def list_types(ws: str) -> List[str]:
    """返回某 workspace 去重后的实体类型列表（按字母升序，给图例用）。"""
    with get_driver().session() as s:
        res = s.run(
            f"MATCH (n:`{ws}`) RETURN DISTINCT coalesce(n.entity_type, '其他') AS t "
            "ORDER BY t"
        )
        return [r["t"] for r in res]


def full_graph(ws: str, limit: int = 300, types: str = ""):
    """全图模式：按度数降序取前 limit 个「核心节点」，再取它们之间的边。

    逻辑与旧版 GraphView.loadGraph 全图分支完全一致：
      1) OPTIONAL MATCH (n)-[r]-() 计算每个节点度数（兼容所有 Neo4j 版本）
      2) 只保留 deg>=2 的节点（排除孤立/叶子），按度数降序取前 limit
      3) 在这些选中的节点之间查所有关系

    types：逗号分隔类型白名单（空 = 不过滤）。前端会用它做类型筛选。
    """
    type_fs = _parse_types(types)
    with get_driver().session() as s:
        # 1) 度数降序取前 N
        q1 = (
            f"MATCH (n:`{ws}`) "
            "WHERE ($typeFs = [] OR coalesce(n.entity_type,'其他') IN $typeFs) "
            "OPTIONAL MATCH (n)-[r]-() "
            "WITH n, count(r) AS deg "
            "WHERE deg >= 2 "
            "ORDER BY deg DESC, n.entity_id "
            "LIMIT $limit "
            "RETURN id(n) AS id, n.entity_id AS name, "
            "coalesce(n.entity_type,'其他') AS type, "
            "n.description AS descr, coalesce(n.source_id,'') AS src, "
            "coalesce(n.file_path,'') AS fp, properties(n) AS props, deg"
        )
        r1 = s.run(q1, typeFs=type_fs, limit=limit)
        nodes = [node_record(r) for r in r1]
        # 2) 取这些节点之间的所有关系
        edges = []
        if nodes:
            ids = [n["id"] for n in nodes]
            q2 = (
                "UNWIND $ids AS i "
                "MATCH (a)-[r]->(b) WHERE id(a) = i AND id(b) IN $ids "
                "WITH id(a) AS s, id(b) AS t, "
                "collect(coalesce(r.description, type(r))) AS ds, "
                "collect(coalesce(r.keywords,'')) AS kws, "
                "collect(coalesce(r.source_id,'')) AS srcs, "
                "collect(coalesce(r.file_path,'')) AS fps "
                "RETURN s, t, ds, kws, srcs, fps"
            )
            r2 = s.run(q2, ids=ids)
            edges = [
                {
                    "s": _to_int(r["s"]),
                    "t": _to_int(r["t"]),
                    "ds": list(r["ds"]),
                    "kws": list(r["kws"]),
                    "srcs": list(r["srcs"]),
                    "fps": list(r["fps"]),
                }
                for r in r2
            ]
        return {"nodes": nodes, "edges": edges, "centerIds": []}


def search_graph(ws: str, kw: str = "", hops: int = 1, cap: int = 300,
                 types: str = ""):
    """按名称子串找到中心节点，再以它们为中心 BFS 向外扩 k 跳邻居。

    逻辑与旧版 GraphView.radialFetch 一致：
      1) 中心按名称子串匹配，取名称最短的 3 个（不受类型筛选）
      2) 从中心 BFS 一圈一圈扩张，每圈查询「frontier 的邻居且 NOT IN seen」，
         邻居节点吃类型筛选（types 白名单）
      3) 每圈后把「已见集合内」的关系也查回来
    总节点数不超过 cap（前端节点上限）。
    """
    type_fs = _parse_types(types)
    with get_driver().session() as s:
        # 1) 找中心节点
        r0 = s.run(
            f"MATCH (n:`{ws}`) WHERE n.entity_id CONTAINS $kw "
            "RETURN id(n) AS id, n.entity_id AS name, "
            "coalesce(n.entity_type,'其他') AS type, "
            "n.description AS descr, coalesce(n.source_id,'') AS src, "
            "coalesce(n.file_path,'') AS fp, properties(n) AS props "
            "ORDER BY size(n.entity_id) LIMIT 3",
            kw=kw,
        )
        centers = [node_record(r) for r in r0]
        if not centers:
            return {"nodes": [], "edges": [], "centerIds": []}

        node_map = {n["id"]: n for n in centers}
        seen = set(n["id"] for n in centers)
        edge_map = {}
        frontier = [n["id"] for n in centers]

        # 2) BFS 扩张
        for _ in range(1, hops + 1):
            if not frontier or len(seen) >= cap:
                break
            cap_left = max(cap - len(seen), 1)
            r1 = s.run(
                f"MATCH (a)-[r]-(b:`{ws}`) "
                "WHERE id(a) IN $frontier AND NOT id(b) IN $seen "
                "AND ($typeFs = [] OR coalesce(b.entity_type,'其他') IN $typeFs) "
                "RETURN DISTINCT id(b) AS id, b.entity_id AS name, "
                "coalesce(b.entity_type,'其他') AS type, "
                "b.description AS descr, coalesce(b.source_id,'') AS src, "
                "coalesce(b.file_path,'') AS fp, properties(b) AS props "
                "LIMIT $cap",
                frontier=list(frontier), seen=list(seen), typeFs=type_fs,
                cap=cap_left,
            )
            new_ids = []
            for rec in r1:
                nid = _to_int(rec["id"])
                if nid not in node_map:
                    node_map[nid] = node_record(rec)
                    new_ids.append(nid)
            seen.update(new_ids)
            # 3) 取「已见节点之间」的关系
            if new_ids:
                r2 = s.run(
                    "MATCH (a)-[r]->(b) WHERE id(a) IN $seen AND id(b) IN $seen "
                    "RETURN id(r) AS rid, id(a) AS s, id(b) AS t, "
                    "coalesce(r.description, type(r)) AS d, "
                    "coalesce(r.keywords,'') AS kw, "
                    "coalesce(r.source_id,'') AS src, "
                    "coalesce(r.file_path,'') AS fp",
                    seen=list(seen),
                )
                for rec in r2:
                    rid = _to_int(rec["rid"])
                    if rid not in edge_map:
                        edge_map[rid] = {
                            "s": _to_int(rec["s"]),
                            "t": _to_int(rec["t"]),
                            "ds": [rec["d"] or ""],
                            "kws": [rec["kw"] or ""],
                            "srcs": [rec["src"] or ""],
                            "fps": [rec["fp"] or ""],
                        }
            frontier = new_ids

        return {
            "nodes": list(node_map.values()),
            "edges": list(edge_map.values()),
            "centerIds": [n["id"] for n in centers],
        }


def expand_graph(ws: str, node_id: int, hops: int = 1, types: str = ""):
    """以指定节点 ID 为中心做 k 跳展开（邻居吃类型筛选）。

    逻辑与旧版 GraphView.expandFromNode 一致：
      1) 先取出中心节点的全部信息
      2) 从中心 BFS 向外扩 k 跳（每圈查 frontier 邻居 NOT IN seen，邻居吃类型筛选）
      3) 每圈后取「已见节点之间」的关系
    """
    type_fs = _parse_types(types)
    with get_driver().session() as s:
        # 取中心节点
        rc = s.run(
            f"MATCH (n:`{ws}`) WHERE id(n)=$id "
            "RETURN id(n) AS id, n.entity_id AS name, "
            "coalesce(n.entity_type,'其他') AS type, "
            "n.description AS descr, coalesce(n.source_id,'') AS src, "
            "coalesce(n.file_path,'') AS fp, properties(n) AS props",
            id=node_id,
        )
        recs = [r for r in rc]
        if not recs:
            return {"nodes": [], "edges": [], "centerIds": []}
        center = node_record(recs[0])
        node_map = {center["id"]: center}
        seen = {center["id"]}
        edge_map = {}
        frontier = [center["id"]]

        # BFS 扩张
        for _ in range(1, hops + 1):
            if not frontier:
                break
            r1 = s.run(
                "MATCH (a)-[r]-(b) WHERE id(a) IN $frontier AND NOT id(b) IN $seen "
                "AND ($typeFs = [] OR coalesce(b.entity_type,'其他') IN $typeFs) "
                "RETURN DISTINCT id(b) AS id, b.entity_id AS name, "
                "coalesce(b.entity_type,'其他') AS type, "
                "b.description AS descr, coalesce(b.source_id,'') AS src, "
                "coalesce(b.file_path,'') AS fp, properties(b) AS props",
                frontier=list(frontier), seen=list(seen), typeFs=type_fs,
            )
            new_ids = []
            for rec in r1:
                nid = _to_int(rec["id"])
                if nid not in node_map:
                    node_map[nid] = node_record(rec)
                    new_ids.append(nid)
            seen.update(new_ids)
            if new_ids:
                r2 = s.run(
                    "MATCH (a)-[r]->(b) WHERE id(a) IN $seen AND id(b) IN $seen "
                    "RETURN id(r) AS rid, id(a) AS s, id(b) AS t, "
                    "coalesce(r.description, type(r)) AS d, "
                    "coalesce(r.keywords,'') AS kw, "
                    "coalesce(r.source_id,'') AS src, "
                    "coalesce(r.file_path,'') AS fp",
                    seen=list(seen),
                )
                for rec in r2:
                    rid = _to_int(rec["rid"])
                    if rid not in edge_map:
                        edge_map[rid] = {
                            "s": _to_int(rec["s"]),
                            "t": _to_int(rec["t"]),
                            "ds": [rec["d"] or ""],
                            "kws": [rec["kw"] or ""],
                            "srcs": [rec["src"] or ""],
                            "fps": [rec["fp"] or ""],
                        }
            frontier = new_ids

        return {
            "nodes": list(node_map.values()),
            "edges": list(edge_map.values()),
            "centerIds": [center["id"]],
        }


def node_props(ws: str, name: str):
    """按 entity_id 精确匹配，返回单个节点的 properties（右侧详情用）。"""
    with get_driver().session() as s:
        r = s.run(
            f"MATCH (n:`{ws}`) WHERE n.entity_id = $name "
            "RETURN properties(n) AS props LIMIT 1",
            name=name,
        )
        rec = r.single()
        if not rec:
            return {"props": {}}
        return {"props": _sanitize(rec["props"] or {})}

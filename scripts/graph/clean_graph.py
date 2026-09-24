#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
clean_graph.py —— 清理 6 个子图工作区
==================================================================
业务用途：在做完 LightRAG 抽取后，图里会有不少\"噪音节点\"，本脚本做三步清理：
  1. 删除孤立点（无任何连线）—— 没跟别人连上，多半是抽取噪声
  2. 只保留\"最大弱连通分量\"（核心社群），删除其余小碎片节点
  3. 扫描并报告疑似同义重复实体（供人工合并，不自动删）

用法:
    python clean_graph.py [g01|g02|...|all]     # 不传参数 = all（处理全部 7 个，含 g00）

说明：下列 AUTH 不再写死在代码里，而是从环境变量 NEO4J_PASSWORD 读取。
       默认值在 .env.example 提供（开发用，与 docker-compose 默认一致）。
       真正运行前请确保本目录或父目录存在 .env 文件，或直接 export NEO4J_PASSWORD。
"""
import os
import sys
from collections import Counter, deque, defaultdict
from neo4j import GraphDatabase

# ===== 配置（凭证从环境变量读）=====
# 展示版 neo4j-display（清理后的精简图）。注意：这里端口 7688 是反代端口。
URI = os.environ.get("NEO4J_URI_PRUNE", "bolt://localhost:7688")
AUTH_USER = os.environ.get("NEO4J_USERNAME", "neo4j")
AUTH_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
AUTH = (AUTH_USER, AUTH_PASSWORD)
if not AUTH_PASSWORD:
    print("⚠️  NEO4J_PASSWORD 环境变量未设置，无法连接 Neo4j。")
    print("   请在 .env 中设置后重试；详见 .env.example。")
    sys.exit(1)
LABELS = ["g00_master_all", "g01_people_literature", "g02_places_routes", "g03_varieties",
          "g04_history_institutions", "g05_lingnan_liwan", "g06_industry_tech"]

# 课程明确的同义别名表（保留键 = 规范名）
ALIASES = {
    "杨贵妃": ["杨玉环", "杨贵妃（杨玉环）", "杨玉环（杨贵妃）", "杨太真", "贵妃杨玉环"],
    "长安": ["京师", "西京", "唐都长安"],
    "涪州": ["涪", "涪陵", "涪陵郡"],
    "高力士": ["高力士（冯元一）", "冯元一"],
    "妃子笑": ["妃子笑荔枝", "妃子笑品种", "妃子笑（糯米糍）"],
    "荔枝": ["荔枝（水果）", "荔枝树"],
    "张九龄": ["张九龄（曲江）", "张子寿"],
    "杜牧": ["杜牧（牧之）"],
    "苏轼": ["苏东坡", "苏轼（东坡）"],
    "广州": ["广州市"],
    "茂名": ["茂名市"],
    "增城": ["增城区", "增城县"],
    "从化": ["从化区", "从化县"],
    "东莞": ["东莞市"],
    "高州": ["高州市"],
    "电白": ["电白区", "电白县"],
    "廉江": ["廉江市"],
    "潮州": ["潮州市"],
    "番禺": ["番禺区", "番禺县"],
    "岭南": ["岭表", "岭外", "五岭以南"],
    "交州": ["交趾"],
    "岭南节度使": ["岭南五府经略使"],
    "西关": ["西关（荔湾）"],
    "泮塘": ["泮塘村", "泮塘五秀"],
    "增城挂绿": ["挂绿", "西园挂绿"],
    "三月红": ["三月红荔枝"],
    "糯米糍": ["糯米糍荔枝"],
    "桂味": ["桂味荔枝"],
    "白糖罂": ["白糖罂荔枝"],
    "怀枝": ["怀枝荔枝", "槐枝"],
    "状元红": ["状元红荔枝"],
    "天宝": ["天宝年间"],
    "开元": ["开元年间"],
    "贞观": ["贞观年间"],
}

def canonical_name(name):
    """返回规范名：若 name 是某别名的精确匹配，返回别名表规范名"""
    for canon, alts in ALIASES.items():
        if name in alts:
            return canon
    return name

def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else ["all"]
    if targets == ["all"]:
        targets = LABELS
    drv = GraphDatabase.driver(URI, auth=AUTH)
    with drv.session() as s:
        for L in targets:
            print("=" * 70)
            print(f"== {L}")
            nodes = s.run(f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name, "
                          "coalesce(n.entity_type,'其他') AS typ").data()
            if not nodes:
                print("  空，跳过")
                continue
            nid = {n['i'] for n in nodes}
            rels = s.run(f"MATCH (a:`{L}`)-[r]->(b:`{L}`) RETURN id(a) AS x, id(b) AS y, r").data()
            deg = Counter()
            for r in rels:
                deg[r['x']] += 1
                deg[r['y']] += 1

            # 1. 孤立点
            isolated = [n['i'] for n in nodes if deg[n['i']] == 0]
            # 2. 弱连通分量（在非孤立节点上）
            alive = [n['i'] for n in nodes if deg[n['i']] > 0]
            adj = defaultdict(list)
            for r in rels:
                adj[r['x']].append(r['y'])
                adj[r['y']].append(r['x'])
            seen = set(); comps = []
            for i in alive:
                if i in seen:
                    continue
                q = deque([i]); seen.add(i); comp = []
                while q:
                    u = q.popleft(); comp.append(u)
                    for v in adj[u]:
                        if v not in seen:
                            seen.add(v); q.append(v)
                comps.append(comp)
            comps.sort(key=len, reverse=True)
            keep_ids = set(comps[0]) if comps else set()
            drop_ids = [i for i in alive if i not in keep_ids]
            all_drop = isolated + drop_ids

            name_of = {n['i']: n['name'] for n in nodes}
            print(f"  清理: 孤立 {len(isolated)} + 碎片 {len(drop_ids)} = {len(all_drop)} 节点将被删除")
            print(f"  保留: {len(keep_ids)} 节点 (最大分量 {len(comps[0]) if comps else 0})")
            # 删除
            if all_drop:
                s.run(f"MATCH (n) WHERE id(n) IN $ids DETACH DELETE n",
                      ids=list(all_drop))
            print("  已删除")

            # 3. 扫描同义候选（仍在图中的节点，规范名重名 或 名称包含）
            rest = s.run(f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name, "
                         "coalesce(n.entity_type,'其他') AS typ").data()
            bykey = defaultdict(list)
            for n in rest:
                nm = n['name'] or ''
                canon = canonical_name(nm.strip())
                key = (canon, n['typ'])
                bykey[key].append(n)
            dups = {k: v for k, v in bykey.items() if len(v) > 1}
            if dups:
                print(f"  疑似同义重复实体 (规范名重名) {len(dups)} 组:")
                for (nm, typ), items in list(dups.items())[:30]:
                    print(f"    [{typ}] '{nm}' x{len(items)}: " +
                          ", ".join("'%s'" % (i['name'] or '?') for i in items[:8]))
            else:
                print("  无规范名重名")
    drv.close()

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分析 6 个子图工作区：节点/关系/孤立点/连通分量/类型分布/疑似重复实体"""
import sys
from collections import Counter, deque
from neo4j import GraphDatabase

URI = "bolt://lightrag-neo4j:7687"
AUTH = ("neo4j", "LightRAG2026neo4j")
LABELS = ["g01_people_literature", "g02_places_routes", "g03_varieties",
          "g04_history_institutions", "g05_lingnan_liwan", "g06_industry_tech"]

def main():
    drv = GraphDatabase.driver(URI, auth=AUTH)
    with drv.session() as s:
        for L in LABELS:
            print("=" * 70)
            print(f"== {L}")
            # 节点与类型
            nodes = s.run(
                f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name, "
                "coalesce(n.entity_type,'其他') AS typ").data()
            print(f"总节点: {len(nodes)}")
            typc = Counter(n['typ'] for n in nodes)
            print("类型分布: " + ", ".join(f"{k}:{v}" for k, v in typc.most_common()))
            # 关系
            rels = s.run(
                f"MATCH (a:`{L}`)-[r]->(b:`{L}`) RETURN id(a) AS x, id(b) AS y").data()
            print(f"内部关系: {len(rels)}")
            # 度
            deg = Counter()
            for r in rels:
                deg[r['x']] += 1
                deg[r['y']] += 1
            nset = {n['i'] for n in nodes}
            isolated = [n['name'] for n in nodes if deg[n['i']] == 0]
            print(f"孤立点(无连线): {len(isolated)} / {len(nodes)}")
            if isolated:
                print("  示例: " + " | ".join(isolated[:20]))
            # 弱连通分量
            adj = {}
            for n in nodes:
                adj[n['i']] = []
            for r in rels:
                adj[r['x']].append(r['y'])
                adj[r['y']].append(r['x'])
            seen = set()
            comps = []
            for i in nset:
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
            print(f"连通分量: {len(comps)} 个，Top: " +
                  ", ".join(f"{len(c)}" for c in comps[:6]) + (" ..." if len(comps) > 6 else ""))
            # 非孤立但属于小分量(可考虑清除): 排除最大分量后的节点
            if comps:
                big = set(comps[0])
                droppable = [n['name'] for n in nodes if n['i'] not in big]
                # 只列小分量里的节点(不含孤立, 因为孤立单独报)
                small = [nm for nm in droppable if deg[n['i']] > 0]
                print(f"不在最大分量中的非孤立节点: {len(small)}")
                if small:
                    print("  示例: " + " | ".join(small[:15]))
    drv.close()

if __name__ == "__main__":
    main()

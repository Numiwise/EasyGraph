#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze_graph.py —— 对 6 个子图工作区做"清点体检"
==================================================================
业务用途：
    在我们做完 LightRAG 抽取 + 入库 Neo4j 之后，想"看一眼"图谱质量。
    本脚本输出每个工作区的：
      - 节点总数 + entity_type 分布
      - 内部关系数
      - 孤立点（度数为 0 的节点；可能值得清理）
      - 弱连通分量（最大分量之外的小簇；可能考虑合并或清除）
      - 同一大簇外的"非孤立但仍孤立的小簇"节点

环境要求：
    - pip install neo4j
    - Neo4j 在 bolt://lightrag-neo4j:7687（容器化场景），用户名密码见 AUTH
    - 已经做好 LightRAG 入库（各 ws 的 label 已经有节点）

运行：
    python scripts/graph/analyze_graph.py
"""
import sys
from collections import Counter, deque  # Counter 做计数；deque 做 BFS 队列
from neo4j import GraphDatabase          # Neo4j 的 Python 驱动（bolt 协议）

# ===== 配置（与部署环境一致，必要时改这里即可） =====
# 说明：AUTH 是本机/内网开发库固定凭据；若推到公网请改读环境变量，勿硬编码。
URI = "bolt://lightrag-neo4j:7687"
AUTH = ("neo4j", "LightRAG2026neo4j")
# 6 个子库（不包含总图谱 g00_master_all；total 节点数太杂不好盘点）
LABELS = ["g01_people_literature", "g02_places_routes", "g03_varieties",
          "g04_history_institutions", "g05_lingnan_liwan", "g06_industry_tech"]


def main():
    # GraphDatabase.driver(uri, auth) → 拿到一个 Driver 实例
    # Driver 内部维护连接池；这里退出 with 前会自动关闭
    drv = GraphDatabase.driver(URI, auth=AUTH)
    with drv.session() as s:
        # 对每个子库跑一遍统计
        for L in LABELS:
            print("=" * 70)
            print(f"== {L}")

            # 1) 节点与类型
            # f-string 的反引号 `{L}` 让 Cypher 把 label 当字面量用（label 不能参数化）
            nodes = s.run(
                f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name, "
                "coalesce(n.entity_type,'其他') AS typ").data()
            print(f"总节点: {len(nodes)}")
            # Counter 自动统计每个 typ 出现次数；most_common() 按多到少排
            typc = Counter(n['typ'] for n in nodes)
            print("类型分布: " + ", ".join(f"{k}:{v}" for k, v in typc.most_common()))

            # 2) 内部关系（只数 a-r->b 且两端都是 L label 的）
            rels = s.run(
                f"MATCH (a:`{L}`)-[r]->(b:`{L}`) RETURN id(a) AS x, id(b) AS y").data()
            print(f"内部关系: {len(rels)}")

            # 3) 度数（每个节点被多少条关系引用；包括出度+入度）
            deg = Counter()
            for r in rels:
                deg[r['x']] += 1
                deg[r['y']] += 1
            nset = {n['i'] for n in nodes}
            isolated = [n['name'] for n in nodes if deg[n['i']] == 0]
            print(f"孤立点(无连线): {len(isolated)} / {len(nodes)}")
            if isolated:
                print("  示例: " + " | ".join(isolated[:20]))

            # 4) 弱连通分量（用 BFS 找每个连通块）
            #    邻接表建图（无向图）
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
                # 从节点 i 出发 BFS，把所有能到达的节点收集到一个 comp
                q = deque([i]); seen.add(i); comp = []
                while q:
                    u = q.popleft(); comp.append(u)
                    for v in adj[u]:
                        if v not in seen:
                            seen.add(v); q.append(v)
                comps.append(comp)
            # 大到小排（最大连通块排在前面）
            comps.sort(key=len, reverse=True)
            print(f"连通分量: {len(comps)} 个，Top: " +
                  ", ".join(f"{len(c)}" for c in comps[:6]) + (" ..." if len(comps) > 6 else ""))

            # 5) 不在最大分量内、但有非零度数的小簇（可考虑合并或剔除）
            if comps:
                big = set(comps[0])
                # 注意：节点名查表用 n['name']，但 deg 用 n['i']
                droppable = [n['name'] for n in nodes if n['i'] not in big]
                # 排除孤立点（孤立点已单独打印，这里只看"小簇里活的"）
                small = [nm for nm in droppable if deg[n['i']] > 0]
                print(f"不在最大分量中的非孤立节点: {len(small)}")
                if small:
                    print("  示例: " + " | ".join(small[:15]))
    # Driver 不在 with 内关闭时，记得手动 close（这里用 with 是因为 drv 是 GraphDatabase 实例）
    drv.close()


if __name__ == "__main__":
    main()

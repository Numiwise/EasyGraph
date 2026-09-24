#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prune_kcore.py —— k-core 修剪 + 只保留最大连通分量
==================================================================
业务用途：
    前两个修剪脚本（prune_graph / clean_graph）按"类型白名单"和"孤立点"清理，
    但仍可能残留"链式挂件"——一条长链的中间节点虽然连了两端，
    却和核心社群关系不大。本脚本用更严格的图论办法处理：
    策略：
      1. 迭代摘除度 < k 的节点（k-core 修剪）：孤立点、叶子、链式挂件都脱落
      2. 再只保留最大弱连通分量（剔除游离小集团）
      3. 同时删掉小分量（< MIN_COMP 节点），保留核心大集团

用法:
  python prune_kcore.py                # 默认 k=2（保留所有 deg>=2 的节点）+ 全部子图
  python prune_kcore.py --k 3          # 3-core（更严格，剩 deg>=3）
  python prune_kcore.py g01_people_literature   # 仅处理特定子图

安全说明：AUTH 是本机开发库固定凭据；若推到公网请改读环境变量。
"""
import sys, argparse
from collections import Counter, deque, defaultdict
from neo4j import GraphDatabase

URI = "bolt://localhost:7688"   # 展示版 neo4j-display
AUTH = ("neo4j", "LightRAG2026neo4j")
LABELS = ["g00_master_all", "g01_people_literature", "g02_places_routes", "g03_varieties",
          "g04_history_institutions", "g05_lingnan_liwan", "g06_industry_tech"]
# 小于这个规模的连通分量整体删掉（视为游离小组）
MIN_COMP = 6

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=2, help="k-core 阈值（默认 2：保留 deg>=2）")
    ap.add_argument("--min-comp", type=int, default=MIN_COMP, help="最小保留分量节点数")
    args = ap.parse_args()

    targets = sys.argv[1:]
    # 去掉命令行 flag
    targets = [t for t in targets if not t.startswith("--") and t not in
               [str(args.k), str(args.min_comp)]]
    if not targets:
        targets = LABELS

    drv = GraphDatabase.driver(URI, auth=AUTH)
    with drv.session() as s:
        for L in targets:
            print("=" * 70)
            print(f"== {L}  (k={args.k}, min_comp={args.min_comp})")
            nodes = s.run(f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name").data()
            rels = s.run(f"MATCH (a:`{L}`)-[r]->(b:`{L}`) RETURN id(a) AS x, id(b) AS y").data()
            nset = {n['i'] for n in nodes}
            adj = defaultdict(set)
            for r in rels:
                adj[r['x']].add(r['y'])
                adj[r['y']].add(r['x'])
            # 仅统计同图内部邻居
            deg = {i: len(adj[i] & nset) for i in nset}

            # ---- k-core：迭代摘除度 < k 的节点 ----
            # 图论"k-core 修剪"：反复删除度数 < k 的节点（删除后会让邻居度数下降，
            # 可能又触发新的删除）。最终剩下的子图里每个节点度数都 >= k，
            # 也就没有"叶子/链尾"这类弱连接了。
            alive = set(nset)                       # 还能存活（未删除）的节点集合
            ddeg = dict(deg)                        # 当前实时度数（会随删除递减）
            # 初始把所有度 < k 的节点入队，逐一出队并摘除
            q = deque(i for i in alive if ddeg[i] < args.k)
            removed = set()
            while q:
                u = q.popleft()
                if u not in alive or ddeg[u] >= args.k:
                    continue
                alive.discard(u); removed.add(u)
                for v in adj[u]:
                    if v in alive:
                        ddeg[v] -= 1
                        if ddeg[v] < args.k:
                            q.append(v)
            print(f"   {args.k}-core 修剪: 摘除弱连接节点 {len(removed)}")

            # ---- 找出所有连通分量，仅保留最大分量且节点数 ≥ MIN_COMP ----
            comps = []
            seen = set()
            for i in alive:
                if i in seen:
                    continue
                qq = deque([i]); seen.add(i); comp = []
                while qq:
                    u = qq.popleft(); comp.append(u)
                    for v in adj[u] & alive:
                        if v not in seen:
                            seen.add(v); qq.append(v)
                comps.append(comp)
            comps.sort(key=len, reverse=True)
            # 只保留「最大且 ≥ MIN_COMP」的分量
            keep = set(comps[0]) if comps and len(comps[0]) >= args.min_comp else set()
            frag = [i for i in alive if i not in keep]
            print(f"   分量清理: 共 {len(comps)} 个分量, 保留最大 {len(keep)}, "
                  f"删游离小组 {len(frag)} 节点 ({len(comps) - (1 if keep else 0)} 个小组)")

            drop = removed | set(frag)
            if drop:
                s.run("MATCH (n) WHERE id(n) IN $ids DETACH DELETE n", ids=list(drop))
            final = s.run(f"MATCH (n:`{L}`) RETURN count(n) AS c").single()['c']
            # 剩余最低度数
            rest = s.run(f"MATCH (n:`{L}`) RETURN id(n) AS i").data()
            rest_deg = {}
            if rest:
                r2 = s.run(f"MATCH (a:`{L}`)-[r]->(b:`{L}`) RETURN id(a) AS x, id(b) AS y").data()
                for e in r2:
                    rest_deg[e['x']] = rest_deg.get(e['x'], 0) + 1
                    rest_deg[e['y']] = rest_deg.get(e['y'], 0) + 1
            min_deg = min(rest_deg.values()) if rest_deg else 0
            print(f"   完成: {len(nodes)} → {final} 节点; 剩余最低度 {min_deg} (≥{args.k})")
    drv.close()

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按维度类型白名单删减子图：
  1. 删除白名单外类型的所有节点
  2. 删除删减后产生的孤立点
  3. 只保留最大弱连通分量（核心社群）
与各维度专属 Profile（lychee_g0X_*.yml）的类型白名单保持一致。
"""
import sys
from collections import Counter, deque, defaultdict
from neo4j import GraphDatabase

URI = "bolt://localhost:7688"   # 展示版 neo4j-display
AUTH = ("neo4j", "LightRAG2026neo4j")

WHITELIST = {
    # 总图：15 类官方实体（拒绝"其他"/"UNKNOWN"等垃圾类型）
    "g00_master_all":
        {"人物", "作品文献", "荔枝品种", "物产作物", "地点", "交通线路",
         "历史事件", "朝代年号", "制度", "文化符号", "古荔枝树",
         "产区产业", "技术", "组织机构", "数据指标"},
    "g01_people_literature":
        {"人物", "作品文献", "历史事件", "朝代年号", "文化符号", "荔枝品种", "地点"},
    "g02_places_routes":
        {"地点", "交通线路", "数据指标", "制度", "历史事件", "朝代年号", "物产作物", "荔枝品种"},
    "g03_varieties":
        {"荔枝品种", "古荔枝树", "物产作物", "地点", "数据指标", "文化符号", "作品文献", "技术"},
    "g04_history_institutions":
        {"制度", "历史事件", "朝代年号", "地点", "作品文献", "物产作物", "数据指标", "人物"},
    "g05_lingnan_liwan":
        {"文化符号", "地点", "历史事件", "朝代年号", "人物", "组织机构", "物产作物", "作品文献"},
    "g06_industry_tech":
        {"产区产业", "技术", "数据指标", "地点", "荔枝品种", "组织机构", "历史事件", "文化符号"},
}

def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(WHITELIST)
    drv = GraphDatabase.driver(URI, auth=AUTH)
    with drv.session() as s:
        for L in targets:
            wl = WHITELIST[L]
            print("=" * 70)
            print(f"== {L}")
            print(f"   白名单: {sorted(wl)}")
            nodes = s.run(f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name, "
                          "coalesce(n.entity_type,'其他') AS typ").data()
            print(f"   现有节点: {len(nodes)}")

            # 1. 白名单外类型
            out_of_scope = [n['i'] for n in nodes if n['typ'] not in wl]
            out_types = Counter(n['typ'] for n in nodes if n['typ'] not in wl)
            if out_of_scope:
                print(f"   删白名单外类型: {dict(out_types)} (共 {len(out_of_scope)} 节点)")
                s.run("MATCH (n) WHERE id(n) IN $ids DETACH DELETE n", ids=out_of_scope)

            # 2. 重新载入，删孤立 + 非最大分量
            nodes = s.run(f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name, "
                          "coalesce(n.entity_type,'其他') AS typ").data()
            rels = s.run(f"MATCH (a:`{L}`)-[r]->(b:`{L}`) RETURN id(a) AS x, id(b) AS y").data()
            deg = Counter()
            for r in rels:
                deg[r['x']] += 1
                deg[r['y']] += 1
            alive = [n['i'] for n in nodes if deg[n['i']] > 0]
            isolated = [n['i'] for n in nodes if deg[n['i']] == 0]
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
            keep = set(comps[0]) if comps else set()
            frag = [i for i in alive if i not in keep]
            print(f"   删孤立点: {len(isolated)}")
            print(f"   删碎片(非最大分量): {len(frag)} (保留核心 {len(keep)})")
            drop = isolated + frag
            if drop:
                s.run("MATCH (n) WHERE id(n) IN $ids DETACH DELETE n", ids=drop)

            # 3. 结果
            final = s.run(f"MATCH (n:`{L}`) RETURN count(n) AS c").single()['c']
            typs = s.run(f"MATCH (n:`{L}`) RETURN DISTINCT coalesce(n.entity_type,'其他') AS t "
                         "ORDER BY t").data()
            print(f"   完成: 最终 {final} 节点; 类型: " +
                  ", ".join(t['t'] for t in typs))
    drv.close()

if __name__ == "__main__":
    main()

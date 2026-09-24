#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从展示版/全量版图数据库中删除「纯英文来源」的实体与关系。

判定规则：
  - 节点的 file_path 由 '<SEP>' 连接多个源 md 文件名。
  - 若 file_path 至少包含一个英文来源标记，且「所有」分段都是英文来源标记，
    则该节点为「纯英文来源」，予以删除。
  - 关系同理：纯英文来源的关系（两端可能仍为中文实体）单独删除，
    避免英文文献抽取的边残留在图中。
  - 混合来源（同时含中文文件）的节点/关系予以保留。

英文来源标记（对应已下线的英文文献/网页）：
  - 03-全球格局-FAO亚太荔枝生产报告
  - 03b-全球格局-PMC荔枝全球产业综述
  - 10-育种-NatureGenetics2022荔枝基因组论文

关键实现（Cypher 思路）：
  - 先把 file_path 按 '<SEP>' 拆成数组 parts。
  - ANY(p IN parts WHERE 标记) 判断「是否至少含一个英文来源」。
  - ALL(p IN parts WHERE 标记) 判断「是否所有分段都是英文来源」。
  - 两者同时成立 = 纯英文来源 → 删除；只要含一段中文来源就保留。

用法:
  python remove_english.py [--uri bolt://localhost:7688] [--apply]
  默认仅统计（dry-run），加 --apply 才真正删除。

安全说明：AUTH 是本机开发库固定凭据；若推到公网请改读环境变量。
"""
import sys
import argparse
from neo4j import GraphDatabase

DEFAULT_URI = "bolt://localhost:7688"
AUTH = ("neo4j", "LightRAG2026neo4j")
LABELS = ["g00_master_all", "g01_people_literature", "g02_places_routes", "g03_varieties",
          "g04_history_institutions", "g05_lingnan_liwan", "g06_industry_tech"]

# 英文来源标记（子串匹配，覆盖 .md / .pdf 等后缀）
MARKERS = [
    "FAO亚太荔枝生产报告",
    "PMC荔枝全球产业综述",
    "NatureGenetics2022荔枝基因组论文",
]

def marker_pred():
    """构造 Cypher 中用于判断「分段是否为英文来源」的谓词表达式"""
    conds = " OR ".join(f"p CONTAINS '{m}'" for m in MARKERS)
    return conds

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uri", default=DEFAULT_URI)
    ap.add_argument("--apply", action="store_true", help="真正执行删除（默认仅统计）")
    args = ap.parse_args()

    drv = GraphDatabase.driver(args.uri, auth=AUTH)
    pred = marker_pred()
    total_nodes, total_rels = 0, 0
    with drv.session() as s:
        for L in LABELS:
            # 统计纯英文节点
            ncount = s.run(
                f"MATCH (n:`{L}`) WHERE n.file_path IS NOT NULL "
                f"WITH n, [p IN split(n.file_path, '<SEP>') | trim(p)] AS parts "
                f"WHERE ANY(p IN parts WHERE ({pred})) AND ALL(p IN parts WHERE ({pred})) "
                f"RETURN count(n) AS c"
            ).single()["c"]
            # 统计纯英文关系
            rcount = s.run(
                f"MATCH (a:`{L}`)-[r]->(b:`{L}`) WHERE r.file_path IS NOT NULL "
                f"WITH r, [p IN split(r.file_path, '<SEP>') | trim(p)] AS parts "
                f"WHERE ANY(p IN parts WHERE ({pred})) AND ALL(p IN parts WHERE ({pred})) "
                f"RETURN count(r) AS c"
            ).single()["c"]

            print(f"== {L}: 纯英文来源 节点 {ncount} / 关系 {rcount}")
            total_nodes += ncount
            total_rels += rcount

            if args.apply and (ncount or rcount):
                # 先删关系，再删节点（避免悬空关系）
                s.run(
                    f"MATCH (a:`{L}`)-[r]->(b:`{L}`) WHERE r.file_path IS NOT NULL "
                    f"WITH r, [p IN split(r.file_path, '<SEP>') | trim(p)] AS parts "
                    f"WHERE ANY(p IN parts WHERE ({pred})) AND ALL(p IN parts WHERE ({pred})) "
                    f"DELETE r"
                )
                s.run(
                    f"MATCH (n:`{L}`) WHERE n.file_path IS NOT NULL "
                    f"WITH n, [p IN split(n.file_path, '<SEP>') | trim(p)] AS parts "
                    f"WHERE ANY(p IN parts WHERE ({pred})) AND ALL(p IN parts WHERE ({pred})) "
                    f"DETACH DELETE n"
                )
                print(f"   -> 已删除")
    drv.close()
    print("-" * 60)
    print(f"合计: 纯英文来源 节点 {total_nodes} / 关系 {total_rels}"
          + ("" if args.apply else "  (dry-run，未删除)"))

if __name__ == "__main__":
    main()

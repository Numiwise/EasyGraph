#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同义实体合并：将别名节点所有关系转移到规范名节点（保留关系类型与属性），删除别名节点。
用法: python merge_aliases.py [label ...]（默认全部）

安全说明：
    AUTH 不再写死在代码里，而是从环境变量 NEO4J_PASSWORD 读取。
    默认值在 .env.example 提供（开发用，与 docker-compose 默认一致）。
    真正运行前请确保本目录或父目录存在 .env 文件，或直接 export NEO4J_PASSWORD。
"""
import os
import sys
from collections import defaultdict
from neo4j import GraphDatabase

# ===== 配置（凭证从环境变量读）=====
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
    "茂名": ["茂名市", "茂名县(唐代)", "广东省茂名市", "茂名市水果试验场培训中心"],
    "增城": ["增城区", "增城县", "广东增城", "广州增城"],
    "从化": ["从化区", "从化县", "广州市从化区"],
    "东莞": ["东莞市"],
    "高州": ["高州市"],
    "电白": ["电白区", "电白县", "电白水东镇"],
    "廉江": ["廉江市", "湛江廉江"],
    "潮州": ["潮州市"],
    "番禺": ["番禺区", "番禺县", "番禺城"],
    "岭南": ["岭表", "岭外", "五岭以南"],
    "交州": ["交趾"],
    "岭南节度使": ["岭南五府经略使"],
    "西关": ["西关（荔湾）", "广州西关"],
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
    # ---- 本轮补充：同义/变体去重（压缩实体数，低风险） ----
    "唐代": ["唐", "唐朝"],
    "驿传制度": ["驿传", "汉代驿传制度", "荔枝驿传制度"],
    "十里一置五里一候": ["十里一置五里一候驿制", "十里一置、五里一堠的驿传制度"],
    "驿站": ["驿站(邮传)"],
    "荔枝道": ["荔枝古道"],
    "子午道": ["子午谷路"],
    "过华清宫绝句三首": ["过华清宫", "过华清宫绝句"],
    "解闷十二首": ["解闷"],
    "题郡中荔枝诗十八韵兼寄万州杨八使君": ["题郡中荔枝诗十八韵，兼寄万州杨八使君"],
    "不辞长作岭南人": ["名句日啖荔枝三百颗，不辞长作岭南人",
                       "日啖荔枝三百颗不辞长作岭南人", "《食荔枝》名句不辞长作岭南人"],
    "一骑红尘妃子笑，无人知是荔枝来": ["一骑红尘妃子笑"],
    "唐穆宗罢贡荔枝": ["唐穆宗停贡荔枝"],
    "汉武帝移植荔枝于扶荔宫": ["汉武帝移植荔枝"],
    # ---- 地名去重：特指/旧称/全称 -> 规范名 ----
    "惠州中山公园": ["惠州中山公园(惠州府城遗址公园)"],
    "蜀": ["蜀中", "蜀地", "蜀郡"],
    "柏桥村": ["高州根子镇柏桥村"],
    "新塘": ["新塘镇"],
    "大岭山": ["大岭山镇"],
    "虎门": ["虎门镇", "虎门镇怀德社区"],
    "顺德": ["广东顺德"],
    "灵山": ["广西灵山县", "灵山县"],
    "沙贝": ["沙贝村"],
    "睦和村": ["南沱镇睦和村"],
    "万冲镇": ["海南乐东黎族自治县万冲镇"],
    "仙村镇": ["增城仙村镇竹园村"],
    # ---- 同机构全称/简称合并 ----
    "南宁市柳沙园艺场": ["南宁柳沙园艺场"],
    "国家果树种质广州荔枝圃": ["国家荔枝香蕉种质资源圃(广州)"],
}

def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else LABELS
    drv = GraphDatabase.driver(URI, auth=AUTH)
    with drv.session() as s:
        for L in targets:
            print("=" * 70)
            print(f"== {L}")
            nodes = s.run(f"MATCH (n:`{L}`) RETURN id(n) AS i, n.entity_id AS name, "
                          "coalesce(n.entity_type,'其他') AS typ").data()
            # 名字 -> 节点列表
            byname = defaultdict(list)
            for n in nodes:
                byname[(n['name'] or '').strip()].append(n)
            total_moved = 0
            deleted = 0
            for canon, alts in ALIASES.items():
                canon_nodes = byname.get(canon, [])
                if not canon_nodes:
                    continue
                for alt in alts:
                    alt_nodes = byname.get(alt, [])
                    if not alt_nodes:
                        continue
                    for m in alt_nodes:
                        # 规范节点：优先同类型
                        c = next((n for n in canon_nodes if n['typ'] == m['typ']), canon_nodes[0])
                        if c['i'] == m['i']:
                            continue
                        # 1. 入边： (a)-[r]->(m)  -> (a)-[nr]->(c)，保留类型与属性
                        #    关系类型名来自数据库（字面量拼接），无注入风险
                        in_rows = s.run(
                            "MATCH (a)-[r]->(m) WHERE id(m)=$mid "
                            "RETURN id(a) AS a, type(r) AS t, properties(r) AS p",
                            {"mid": m['i']}).data()
                        # 按类型分组，每类型一条查询建边
                        by_t = {}
                        for row in in_rows:
                            by_t.setdefault(row['t'], []).append(row)
                        for t, rows in by_t.items():
                            for row in rows:
                                props = dict(row['p']) if row['p'] else {}
                                exists = s.run(
                                    "MATCH (a)-[r]->(c) WHERE id(a)=$a AND id(c)=$c AND type(r)=$t "
                                    "RETURN count(r) AS n",
                                    {"a": row['a'], "c": c['i'], "t": t}).single()['n']
                                if exists == 0:
                                    s.run(
                                        f"MATCH (a) WHERE id(a)=$a MATCH (c) WHERE id(c)=$c "
                                        f"CREATE (a)-[nr:`{t}`]->(c) SET nr = $props",
                                        {"a": row['a'], "c": c['i'], "props": props})
                                    total_moved += 1
                        # 2. 出边： (m)-[r]->(b)  -> (c)-[nr]->(b)
                        out_rows = s.run(
                            "MATCH (m)-[r]->(b) WHERE id(m)=$mid "
                            "RETURN id(b) AS b, type(r) AS t, properties(r) AS p",
                            {"mid": m['i']}).data()
                        by_t = {}
                        for row in out_rows:
                            by_t.setdefault(row['t'], []).append(row)
                        for t, rows in by_t.items():
                            for row in rows:
                                props = dict(row['p']) if row['p'] else {}
                                exists = s.run(
                                    "MATCH (c)-[r]->(b) WHERE id(c)=$c AND id(b)=$b AND type(r)=$t "
                                    "RETURN count(r) AS n",
                                    {"c": c['i'], "b": row['b'], "t": t}).single()['n']
                                if exists == 0:
                                    s.run(
                                        f"MATCH (c) WHERE id(c)=$c MATCH (b) WHERE id(b)=$b "
                                        f"CREATE (c)-[nr:`{t}`]->(b) SET nr = $props",
                                        {"c": c['i'], "b": row['b'], "props": props})
                                    total_moved += 1
                        # 3. 删除别名节点（连同残留关系）
                        s.run("MATCH (m) WHERE id(m)=$mid DETACH DELETE m", {"mid": m['i']})
                        deleted += 1
                        print(f"    合并 '{alt}' -> '{canon}'")
            print(f"  转移关系 {total_moved} 条，删除别名节点 {deleted} 个")
    drv.close()

if __name__ == "__main__":
    main()

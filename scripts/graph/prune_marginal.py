#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对「可视化的修剪图数据库」(bolt://localhost:7688, neo4j-display) 删除
与荔枝文化课程关系不大的边缘化/离题/噪声实体，压缩实体与关系数量。

判定原则（人工核查 g00 类型分布后归纳）：
  - 离题泄漏：燃气规划指标（来自荔湾区情文档，与荔枝无关）
  - 无关作物：冬小麦、牡丹、茉莉、武夷茶等
  - 误归类：白鹤梁水下博物馆（归到技术）
  - 噪声文献：新闻标题、乱码、白皮书、无关诗文（牡丹亭/莺莺传等）
  - 无关机构/制度：护士学校、织网店、保甲法等
仅作用于展示库 7688，不触碰 LightRAG 全量库 7687。

用法:
  python prune_marginal.py            # 仅统计，不删除
  python prune_marginal.py --apply    # 真正删除
"""
import sys, argparse
from neo4j import GraphDatabase

DEFAULT_URI = "bolt://localhost:7688"     # 仅展示版（修剪库）
AUTH = ("neo4j", "LightRAG2026neo4j")
LABELS = ["g00_master_all", "g01_people_literature", "g02_places_routes", "g03_varieties",
          "g04_history_institutions", "g05_lingnan_liwan", "g06_industry_tech"]

# 精确实体名黑名单（与荔枝文化课程无关的离题/噪声实体）
BLACKLIST = [
    # ---- 数据指标：燃气规划泄漏（与荔枝无关） ----
    "广州市公建及商业用气占居民用气比值73%～91%(2021-2035)",
    "每年改造20km钢管",
    "荔湾区公建商业用气占居民用气比值120%(2035)",
    "荔湾现状老旧中压钢管66.86km",
    "滨水公共空间新增1200多平方米(2023)",
    # ---- 技术：误归类 ----
    "白鹤梁水下博物馆",
    # ---- 物产作物：无关作物 ----
    "冬小麦", "姚黄花", "山石榴", "木莲", "牡丹花", "茉莉", "桂花",
    "武夷茶", "新垌茶", "海味", "钦北果园鸡", "粟粒芽", "柑橘",
    # ---- 组织机构：无关/边缘 ----
    "中共马鼻岭高排地下党支部", "夏葛女医学堂", "端纳护士学校", "牛记织网店",
    "新湾渔业人民公社", "陕西师范大学", "陕西省社会科学院古籍研究所", "北京SKP",
    # ---- 作品文献：噪声/离题 ----
    "60吨鲜荔枝奔赴北美",
    "品种322个！东莞有个荔枝王国",
    "土地喵--缆猫道",
    "土特产地域色彩代码白皮书",
    "广州市城市燃气发展规划(2021-2035)",
    "东莞日报社官方网站报道(2025-06-18)",
    "今秋又闻桂子香", "咏打蠔诗", "中国古典节序插花", "牡丹亭",
    "莺莺传", "莺莺歌", "病桔", "病橘", "泰族僮族粤族考",
    "隋唐演义", "随园诗话", "八百里加急有多快？ 最快的为日行500里",
    # ---- 制度：无关 ----
    "老旧钢管改造原则", "保甲法", "屬國都尉", "特進",
    # ---- 朝代年号：非年号 ----
    "2023年",
    # ---- 第二批：离题色彩白皮书衍生 + 与荔枝无关的民俗/典故 ----
    "增城荔枝红", "增城挂绿绿",      # 来自《土特产地域色彩代码白皮书》
    "打蠔",                          # 东莞采蠔民俗
    "三绝",                          # 李白歌诗/裴旻剑舞/张旭草书
    "应清", "划清", "拜清",          # 番禺/东莞清明祭祖称谓
    # ---- 第三批：离题地点（与荔枝文化无关的历史/宗教/工程/盐业/矿业/海域噪声） ----
    "816地下核工程",                 # 涪陵地下核工厂遗址，与荔枝无关
    "李长松艺术家工作室",            # 泮塘街区艺术家工作室，噪声
    "北岩普净院", "点易洞",          # 涪州程颐注《易》讲学处，与荔枝无关
    "白鹤梁",                        # 涪陵长江石鱼题刻，与荔枝无关
    "庐山",                          # 白居易/李白无关居所
    "漢水", "雲夢",                  # 东汉和帝南巡地，与荔枝无关
    "金陵",                          # 李白游历地，与荔枝无关
    "陈万宝庄园",                    # 涪陵清代庭院建筑群，与荔枝无关
    "江都",                          # 唐代县名（吴湘案），与荔枝无关
    "緱氏", "章陵",                  # 东汉和帝行幸/祠旧宅地，与荔枝无关
    "顺丰快递荔枝代收点",            # 物流代收点，噪声
    "靖康盐场", "合兰海",            # 东莞盐场/蠔田，与荔枝无关
    "海珠广场",                      # 广州珠江畔广场，无荔枝内容
    "驩州",                          # 唐代流放边州，与荔枝无关
    "旄牛",                          # 蜀郡旄牛县（贡牛尾），与荔枝无关
    "银场村",                        # 增城银矿/革命老区村，与荔枝无关
    "黄家山",                        # 东江要道驿站（种麦），与荔枝无关
    "相公坪",                        # 梅州张九龄停留纪念地，边缘
    "隔山乡",                        # 居巢居廉故乡（十香园），与荔枝无关
    "牛牯嶂",                        # 增城第一高峰，纯地理
    # ---- 第三批：境外纯市场（仅出口目的地，无荔枝生产/文化内涵） ----
    "北美", "日本", "新加坡",
    # ---- 第四批：离题机构（与荔枝无关） ----
    "三署",                          # 汉代五官/左/右三署郎官制，无荔枝关联
    "涪陵学派",                      # 程颐涪州讲学所奠基的宋代理学派系，与荔枝无关
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uri", default=DEFAULT_URI)
    ap.add_argument("--apply", action="store_true", help="真正执行删除（默认仅统计）")
    args = ap.parse_args()

    drv = GraphDatabase.driver(args.uri, auth=AUTH)
    total_nodes, total_rels = 0, 0
    with drv.session() as s:
        # 全局关系数（删前）
        before_rels = s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
        for L in LABELS:
            # 统计该标签下命中的实体
            rows = s.run(
                f"MATCH (n:`{L}`) WHERE n.entity_id IN $bl RETURN count(n) AS c",
                bl=BLACKLIST).single()["c"]
            rels = s.run(
                f"MATCH (a:`{L}`)-[r]->(b:`{L}`) WHERE a.entity_id IN $bl OR b.entity_id IN $bl "
                f"RETURN count(r) AS c", bl=BLACKLIST).single()["c"]
            if rows:
                print(f"== {L}: 命中节点 {rows} / 涉及关系 {rels}")
                total_nodes += rows; total_rels += rels
                if args.apply:
                    s.run(f"MATCH (a:`{L}`)-[r]->(b:`{L}`) "
                          f"WHERE a.entity_id IN $bl OR b.entity_id IN $bl DELETE r",
                          bl=BLACKLIST)
                    s.run(f"MATCH (n:`{L}`) WHERE n.entity_id IN $bl DETACH DELETE n",
                          bl=BLACKLIST)
                    print(f"   -> 已删除")
        after_rels = s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
    drv.close()

    print("-" * 60)
    print(f"命中删除: 节点 {total_nodes} / 涉及关系（删前）{total_rels}")
    print(f"库关系总数: 删前 {before_rels} -> 删后 {after_rels} "
          f"(净减 {before_rels - after_rels})")
    if not args.apply:
        print("(dry-run，未删除；加 --apply 执行)")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
准备「原始资料」供前端浏览器直接打开：
  1) 把 知识图谱/<分类>/原始资料/* 复制到 data/inputs/_origin/（扁平，已随 /kb 挂载）
  2) 生成 data/inputs/_origin_manifest.json
       键 = 已解析 .md 的文件名（去掉 .md 后缀，即 basename）
       值 = 对应的原始文件在 _origin/ 下的文件名（html / pdf / png / jpg ...）

前端据此把「完整原文」链接指向真实原始文件，由浏览器原生打开（html/pdf/png）。
"""
import os, json, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KB = os.path.join(ROOT, "知识图谱")
INP = os.path.join(ROOT, "data", "inputs")
DEST = os.path.join(INP, "_origin")
MANIFEST = os.path.join(INP, "_origin_manifest.json")

PRIORITY = [".html", ".htm", ".pdf", ".png", ".jpg", ".jpeg"]

def main():
    os.makedirs(DEST, exist_ok=True)

    # 1) 收集所有原始文件：basename(无扩展) -> 按优先级挑选的文件名
    orig = {}  # base -> filename
    for cat in sorted(os.listdir(KB)):
        odir = os.path.join(KB, cat, "原始资料")
        if not os.path.isdir(odir):
            continue
        for fn in os.listdir(odir):
            if fn.startswith("."):
                continue
            base, ext = os.path.splitext(fn)
            ext = ext.lower()
            cur = orig.get(base)
            if cur is None:
                orig[base] = fn
            else:
                cur_ext = os.path.splitext(cur)[1].lower()
                if PRIORITY.index(ext) < PRIORITY.index(cur_ext):
                    orig[base] = fn

    # 2) 复制原始文件到 _origin（扁平）
    copied = 0
    for base, fn in orig.items():
        for cat in sorted(os.listdir(KB)):
            src = os.path.join(KB, cat, "原始资料", fn)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(DEST, fn))
                copied += 1
                break

    # 3) 生成 manifest：扫描所有已解析 .md 的 basename
    manifest = {}
    for ws in sorted(os.listdir(INP)):
        pd = os.path.join(INP, ws, "__parsed__")
        if not os.path.isdir(pd):
            continue
        for fn in os.listdir(pd):
            if not fn.lower().endswith(".md"):
                continue
            base = fn[:-3]
            if base in orig:
                manifest[base] = orig[base]

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("原始文件总数:", len(orig))
    print("已复制:", copied)
    print("manifest 条目(.md->原始):", len(manifest))

if __name__ == "__main__":
    main()

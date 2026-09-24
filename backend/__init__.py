#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
api_bridge —— 轻量数据库隔离网关包
==================================================================
本包把「前端原来直连 Neo4j / Qdrant 的读取」收敛到后端一个 FastAPI 服务里，
让浏览器只通过同源 /api/* 访问数据，数据库地址与密码彻底藏进后端环境变量。

模块划分（保持轻量、职责单一）：
    config.py   环境变量配置（Neo4j / Qdrant 连接信息，不含真实 secret）
    db.py       Neo4j 驱动单例 + 返回数据序列化工具
    queries.py  图谱只读查询（Cypher：counts/types/graph/search/expand/node）
    qdrant.py   Qdrant 原文 chunk 只读查询
    main.py     FastAPI 入口，把上述查询挂成 /api/* 路由

启动：uvicorn scripts.api_bridge.main:app --host 0.0.0.0 --port 9630
==================================================================
"""

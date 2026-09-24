# 前端（refactor/vue3-rewrite 分支起步版）

> 起步骨架：Vite + Vue 3 + Element Plus + vis-network + neo4j-driver，
> 把原本「无构建工具、UMD 全局脚本」的 Vue 3 + Options API 写法，
> 搬到了 Vite 工程里。

## 起步骨架的边界

| 已就位 | 备注 |
|---|---|
| `package.json` / `vite.config.js` / `index.html` | 工程根目录 |
| `frontend/src/main.js` | Vue 3 应用入口 |
| `frontend/src/App.vue` | 根组件 |
| `frontend/src/router.js` | Vue Router 4（hash 模式，路由表与旧版一致） |
| `frontend/src/api/{neo4j,lightrag}.js` | ESM 改造：`import neo4j from 'neo4j-driver'` |
| `frontend/src/views/*.js` | 4 个 view **保持原 Options API 写法**，仅加 `defineComponent` 包装 |
| `frontend/src/styles/*.css` | 原样搬过来 |
| `frontend/src/utils/markdown.js` | 原样搬过来 |

| 待推进（后续 PR） | 说明 |
|---|---|
| `views/*.js` → `views/*.vue` | 每个 view 拆为 SFC（`<template>`/`<script setup>`/`<style scoped>`） |
| `Composition API` 重构 | 替换 Options API（data/methods/computed/watch） |
| `vis-network` ESM 直引 | 已用 `import { DataSet, Network }` 起步，可改成 `import 'vis-network/styles/vis-network.css'` |
| docker 镜像替换 | 由 nginx:alpine 直接挂 `dist/`，或保留 nginx 镜像但挂 `./frontend:/dist` + `./nginx` |

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
```

## 构建

```bash
npm run build        # 产物到 ./dist/
npm run preview      # 预览构建产物（端口 5006）
```

## 已知差异 / 风险

1. **chunk 大**：Element Plus 全量样式约 1MB，Neo4j driver 约 600KB（已分 chunk，
   但仍可通过 `unplugin-vue-components` 做按需引入进一步瘦身）。
2. **`vendor-vis` 为空 chunk**：vis-network 在 view 内部被 import，被卷入 index bundle。
   重构 .vue 后可加入 manualChunks 规则。
3. **旧 vendor/ 资源已移除**：分支上不再使用 `frontend/vendor/`，改走 npm + Vite。
   一旦回退到 main 分支，旧 UMD 路径仍可用（备份在 `_refactor_bak/frontend_v2/`）。

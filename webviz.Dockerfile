# ============================================================
# webviz —— Vue3 + Vite 前端可视化大屏（多阶段构建）
# ------------------------------------------------------------
#   Stage 1 (builder)：node:22-alpine 装依赖 → vite build → dist/
#   Stage 2 (runtime)：nginx:alpine 仅托管 dist/ + /kb 原文
#
# 用法（已配 docker-compose.yml）：
#   docker compose build webviz
#   docker compose up -d webviz
# ============================================================

# ========== Stage 1：构建 ==========
FROM node:22-alpine AS builder

WORKDIR /build

# 单独 COPY package* 以利用 docker layer 缓存（依赖未变则跳过 npm ci）
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# 源码（build 过程会读 vite.config.js 等）
COPY frontend ./frontend
COPY index.html ./
COPY vite.config.js ./

# 构建：产出到 ./dist/
RUN npm run build

# ========== Stage 2：运行时（仅托管静态文件） ==========
FROM nginx:1.27-alpine

# 替换默认 nginx 配置（用户 root 跑，便于挂载只读文件）
COPY nginx/nginx-main.conf /etc/nginx/nginx.conf
COPY nginx/nginx-webviz.conf /etc/nginx/conf.d/webviz.conf

# 从构建阶段拷贝产物
COPY --from=builder /build/dist /usr/share/nginx/html

# 健康检查（容器内 curl 检查 SPA index 是否可读）
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

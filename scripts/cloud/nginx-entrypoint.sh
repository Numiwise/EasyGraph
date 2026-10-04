#!/bin/sh
# ============================================================
# cloud-nginx 启动脚本
# 在 nginx 启动前把 webviz.conf.template 用 envsubst 渲染成
# /etc/nginx/conf.d/webviz.conf
# ============================================================
set -e

mkdir -p /etc/nginx/conf.d

# 用 envsubst 替换模板里的 ${VAR} → 实际值
# 仅替换我们配置的三个变量，其余保持原样
envsubst \
  '${SERVER_NAME} ${LLM_BINDING_API_KEY} ${BRIDGE_TOKEN}' \
  < /etc/nginx/templates/webviz.conf.template \
  > /etc/nginx/conf.d/webviz.conf

# 删除 nginx:alpine 自带的 default.conf（与我们的 webviz.conf 都 listen 80，会冲突）
rm -f /etc/nginx/conf.d/default.conf

# 启动 nginx
exec nginx -g 'daemon off;'
#!/bin/bash
# ============================================================
# easygraph 云服务器一键部署脚本（Ubuntu 24.04）
# ------------------------------------------------------------
# 在腾讯云 CVM 上以 root 身份运行：
#   bash cloud-setup.sh
#
# 此脚本：
#   1) 安装 Docker + Docker Compose plugin
#   2) 创建项目目录 /opt/easygraph
#   3) 配置 systemd 自动重启（机器重启后服务自动起来）
# ============================================================

set -e

echo "=========== 1. 安装 Docker + Docker Compose plugin ==========="

if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    echo "Docker installed"
else
    echo "Docker already installed: $(docker --version)"
fi

# 验证 docker-compose plugin（v2 内置命令）
if ! docker compose version &>/dev/null; then
    echo "ERR: docker compose plugin not found"
    exit 1
fi
echo "Docker Compose: $(docker compose version)"

echo ""
echo "=========== 2. 创建项目目录 ==========="

mkdir -p /opt/easygraph
cd /opt/easygraph

mkdir -p data/inputs
mkdir -p backup
mkdir -p nginx
mkdir -p scripts

echo "Project dir created: $(pwd)"

echo ""
echo "=========== 3. 系统参数调整 ==========="

# neo4j 5.x 默认 mmap 很多文件，需调高 vm.max_map_count
sysctl -w vm.max_map_count=262144
echo "vm.max_map_count=262144" > /etc/sysctl.d/99-lightrag.conf

# 增加文件描述符上限（docker 内 nginx worker 多了）
sysctl -w fs.file-max=65536

echo ""
echo "=========== 4. 验证 ==========="
docker --version
docker compose version
docker system info --format 'cpus={{.NCPU}} mem={{.MemTotal}} disk={{.DriverStatus}}' | head -1
echo ""
echo "✅ Cloud server prepared for easygraph"
echo "Next: scp the project files from local Windows to here"

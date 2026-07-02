#!/bin/sh
# 注入运行时变量到 nginx 配置:
# - BACKEND_URL:Forsion server 地址(/api、/auth 等代理到这里)。
# - NGINX_RESOLVER:nginx 变量式 proxy_pass 需要 resolver;取容器实际 resolv.conf 的 nameserver
#   → 默认桥接网(docker run)与 compose 用户网(127.0.0.11)都可用。硬编码 127.0.0.11 在默认桥接网会
#   "Connection refused" 导致 /api 502。
set -e
export BACKEND_URL=${BACKEND_URL:-http://host.docker.internal:3001}
export NGINX_RESOLVER=${NGINX_RESOLVER:-$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)}
export NGINX_RESOLVER=${NGINX_RESOLVER:-127.0.0.11}
envsubst '$BACKEND_URL $NGINX_RESOLVER' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g "daemon off;"

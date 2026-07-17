# syntax=docker/dockerfile:1
# Tangu 云端 worker 镜像(Forsion-Genesis/tangu-agent/);构建上下文 = tangu-agent/。
# CI:.github/workflows/build-worker.yml 推 ghcr.io/changan-su/forsion-tangu-worker。
# 前提:本 worker 插件已置于 ./plugins/forsion-worker/。

# ===== builder:构建核心 + 本插件,裁剪为运行期依赖 =====
FROM node:20-bookworm-slim AS builder
# CN_MIRROR=1 → apt/npm 全走国内镜像(阿里云 ECS 直连 deb.debian.org/npmjs 龟速,实测 apt 一步 20min+)。
# CI(GitHub runner)不传该 arg,官源直连。
ARG CN_MIRROR=
RUN if [ -n "$CN_MIRROR" ]; then sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; fi \
 # 原生模块(better-sqlite3 等)无预编译时需本地编译
 && apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/tangu/core
# 先拷清单装依赖(层缓存),再拷全量源码构建核心 tsc → dist/(含 dist/index.d.ts)
COPY package.json package-lock.json ./
RUN if [ -n "$CN_MIRROR" ]; then npm config set registry https://registry.npmmirror.com; fi \
 && npm ci
COPY . .
RUN npm run build
# 插件已随 COPY . . 进来(plugins/forsion-worker/),构建它(tsconfig paths 指向 ../../dist/index.d.ts)
WORKDIR /opt/tangu/core/plugins/forsion-worker
RUN npm install && npm run build && npm prune --omit=dev
# 核心裁剪掉 devDeps(留已编译的运行期依赖)
WORKDIR /opt/tangu/core
RUN npm prune --omit=dev

# ===== runtime:仅运行期产物(node_modules 从 builder 拷,ABI 一致)=====
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TANGU_PLUGINS_DIR=/opt/tangu/core/plugins \
    TANGU_HOME=/data/.tangu \
    TANGU_WORKER_HOST=0.0.0.0 \
    TANGU_WORKER_PORT=10001 \
    TANGU_SANDBOX=none
WORKDIR /opt/tangu/core
COPY --from=builder /opt/tangu/core/node_modules ./node_modules
COPY --from=builder /opt/tangu/core/dist ./dist
COPY --from=builder /opt/tangu/core/package.json ./package.json
COPY --from=builder /opt/tangu/core/plugins/forsion-worker/dist ./plugins/forsion-worker/dist
COPY --from=builder /opt/tangu/core/plugins/forsion-worker/node_modules ./plugins/forsion-worker/node_modules
COPY --from=builder /opt/tangu/core/plugins/forsion-worker/tangu-plugin.json ./plugins/forsion-worker/tangu-plugin.json
COPY --from=builder /opt/tangu/core/plugins/forsion-worker/package.json ./plugins/forsion-worker/package.json
RUN mkdir -p /data/.tangu
EXPOSE 10001
# tangu = dist/tui/main.js;`worker` 子命令在 TUI 解析前分发到本插件。配置全经 env(见 .env.example)。
ENTRYPOINT ["node", "dist/tui/main.js", "worker"]

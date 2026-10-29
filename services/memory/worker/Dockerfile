# Worker image for the memory service. Build context: repository root.
#   docker build -f services/memory/worker/Dockerfile -t agentic-ai/memory-worker .
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY services/memory services/memory
COPY data/package.json data/package.json
COPY gateway/package.json gateway/package.json
RUN npm ci --ignore-scripts --workspace @agentic-ai/memory --include-workspace-root \
 && npx tsc -b services/memory

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/services/memory/package.json services/memory/package.json
COPY --from=build /app/services/memory/dist/worker services/memory/dist/worker
COPY data/package.json data/package.json
COPY gateway/package.json gateway/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @agentic-ai/memory

# Non-root user without a login shell. Run with a read-only root filesystem:
#   docker run --rm -i --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL \
#     --security-opt no-new-privileges --user 10001:10001 --network <exec network> ...
RUN groupadd --gid 10001 worker && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin worker
USER 10001:10001
ENV HOME=/tmp
ENTRYPOINT ["node", "services/memory/dist/worker/main.js"]

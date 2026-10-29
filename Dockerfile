# Image for a long-running component (gateway, memory, data). Build context: repository root.
#   docker build --build-arg ENTRY=gateway/dist/src/main.js -t agentic-ai/gateway .
# The worker has its own image: services/memory/worker/Dockerfile.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY data data
COPY gateway gateway
COPY services services
RUN npm ci --ignore-scripts && npx tsc -b && npm prune --omit=dev --ignore-scripts

FROM node:26-slim
ARG ENTRY
ENV NODE_ENV=production ENTRY=${ENTRY}
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# Run as the unprivileged "node" user; the root filesystem can be mounted read-only (nothing is written at runtime).
USER node
CMD ["sh", "-c", "exec node \"$ENTRY\""]

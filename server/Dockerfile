# API de seguimiento (Fastify + simulador). Contexto de build: raíz del repo.
FROM node:24-alpine
ARG PNPM_VERSION=11.8.0
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server/src ./src
COPY shared /app/shared
COPY db /app/db
COPY public/zonas /app/public/zonas
COPY public/metro /app/public/metro
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "src/server.ts"]

# syntax=docker/dockerfile:1
# One image for the API, the worker and (preprod only) the mock Magicline.
# Node 26 runs the TypeScript sources directly (type stripping); there is no build step.

FROM node:26.13.0-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@12.18.0
COPY . .
RUN pnpm install --frozen-lockfile --prod \
      --filter @trainmore/api... --filter @trainmore/worker... --filter @trainmore/mock-magicline...

FROM node:26.13.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app /app
USER node
EXPOSE 8080
# Worker runs override the command, e.g. ["node", "apps/worker/src/main.ts", "retention"].
CMD ["node", "apps/api/src/main.ts"]

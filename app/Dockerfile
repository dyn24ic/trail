FROM node:22-alpine AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/ .
# Copy root env file so NEXT_PUBLIC_* vars are available at build time
COPY .env.frontend .env.frontend
ENV NEXT_TELEMETRY_DISABLED=1

# BACKEND_URL is baked in at build time for server components;
# runtime env still overrides for API routes
ARG BACKEND_URL=http://django:8000
ENV BACKEND_URL=$BACKEND_URL

RUN --mount=type=cache,target=/root/.cache/next-swc \
    set -a && . ./.env.frontend && set +a && \
    node_modules/.bin/next build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]

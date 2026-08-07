# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# git is required to install the GitHub-sourced dependency
RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN apk add --no-cache git && \
    npm ci --omit=dev && \
    apk del git

# Copy compiled output and static assets
COPY --from=builder /app/dist ./dist
COPY public/ ./public/

# Unprivileged user for security
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]

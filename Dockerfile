# ==========================================
# Multi-Stage Build for Contest OS Backend
# ==========================================

# 1. Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# 2. Production Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install production dependencies only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Non-root user for security
USER node

EXPOSE 5000

CMD ["node", "dist/server.js"]

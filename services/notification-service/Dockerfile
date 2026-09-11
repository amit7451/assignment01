FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace configuration
COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY services/notification-service/package.json ./services/notification-service/

# Install dependencies across workspace
RUN npm install

# Copy source files
COPY shared ./shared
COPY services/notification-service ./services/notification-service

# Build packages
RUN npm run build --workspace=shared
RUN npm run build --workspace=services/notification-service

# ------------------------------------------------------------------------------
# Production Runner Stage
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install curl for container healthchecks
RUN apk add --no-cache curl

# Copy root and service package files
COPY package.json ./
COPY shared/package.json ./shared/
COPY services/notification-service/package.json ./services/notification-service/

# Install production dependencies only
RUN npm install --omit=dev

# Copy compiled outputs from builder stage
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/services/notification-service/dist ./services/notification-service/dist

WORKDIR /app/services/notification-service

EXPOSE 8002

USER node

CMD ["node", "dist/index.js"]

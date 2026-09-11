FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace configuration
COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY services/api-gateway/package.json ./services/api-gateway/

# Install dependencies across workspace
RUN npm install

# Copy source files
COPY shared ./shared
COPY services/api-gateway ./services/api-gateway

# Build packages
RUN npm run build --workspace=shared
RUN npm run build --workspace=services/api-gateway

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
COPY services/api-gateway/package.json ./services/api-gateway/

# Install production dependencies only
RUN npm install --omit=dev

# Copy compiled outputs from builder stage
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/services/api-gateway/dist ./services/api-gateway/dist

# Copy OpenAPI spec for Swagger UI
COPY docs ./docs

WORKDIR /app/services/api-gateway

EXPOSE 8080

USER node

CMD ["node", "dist/index.js"]

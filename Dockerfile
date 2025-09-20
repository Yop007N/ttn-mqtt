# Multi-stage Docker build for production optimization
FROM node:18-alpine AS base
LABEL maintainer="Enrique Bobadilla <enrique@example.com>"
LABEL description="TTN MQTT Gateway Service"

# Install system dependencies and security updates
RUN apk update && apk upgrade && \
    apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create app directory and non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ttnmqtt -u 1001 -G nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Development stage
FROM base AS development
RUN npm ci --include=dev
COPY . .
RUN chown -R ttnmqtt:nodejs /app
USER ttnmqtt
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Build stage
FROM base AS build
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build && \
    npm prune --production

# Production stage
FROM node:18-alpine AS production

# Install production dependencies and security updates
RUN apk update && apk upgrade && \
    apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ttnmqtt -u 1001 -G nodejs

WORKDIR /app

# Copy built application from build stage
COPY --from=build --chown=ttnmqtt:nodejs /app/dist ./dist
COPY --from=build --chown=ttnmqtt:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=ttnmqtt:nodejs /app/package*.json ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Security: Run as non-root user
USER ttnmqtt

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/app.js"]

# Add labels for better container management
LABEL version="1.0.0"
LABEL environment="production"
LABEL service="ttn-mqtt-gateway"
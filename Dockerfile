# OpenCode Remote Control — production image
# Multi-stage build: install deps → bundle dist → minimal runtime

FROM node:22-alpine AS base

# Install dumb-init for proper signal handling (PID 1 zombie reaping)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts

# Copy the prebuilt dist/ and scripts/
COPY dist/ ./dist/
COPY scripts/ ./scripts/
COPY bin/ ./bin/
COPY tsconfig.json ./

# State and logs directories (persistent volume)
RUN mkdir -p /root/.opencode-remote/state /root/.opencode-remote/logs

# Health check: ensure the bot responds within 30s
# The bot doesn't expose an HTTP endpoint natively, but the parent process
# writes parent.pid when alive. We check that.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD test -f /root/.opencode-remote/parent.pid && \
      ps -p $(cat /root/.opencode-remote/parent.pid) > /dev/null || exit 1

ENV NODE_ENV=production \
    OPENCODE_TIMEOUT=180

# Run as PID 1 with dumb-init for proper signal forwarding
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/cli.js"]
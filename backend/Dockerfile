FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Install bash, git, ssh, docker-cli, expect (for unbuffer), and build dependencies for native modules
RUN apk add --no-cache bash git openssh-client docker-cli expect python3 make g++

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for Claude Code (as per token guide)
RUN addgroup -g 1027 claudeuser && \
    adduser -u 1027 -G claudeuser -s /bin/bash -D claudeuser && \
    mkdir -p /home/claudeuser/.claude /home/claudeuser/.ssh && \
    chown -R claudeuser:claudeuser /home/claudeuser && \
    # Configure git defaults
    git config --global user.email "cc-manager@localhost" && \
    git config --global user.name "CC Manager" && \
    # Configure SSH to accept new host keys (for git clone)
    echo "Host *\n  StrictHostKeyChecking accept-new\n  UserKnownHostsFile /home/claudeuser/.ssh/known_hosts" > /home/claudeuser/.ssh/config && \
    chown -R claudeuser:claudeuser /home/claudeuser/.ssh

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY docker-entrypoint.sh /usr/local/bin/
RUN npm ci --omit=dev && chmod +x /usr/local/bin/docker-entrypoint.sh

# Clean up build dependencies to reduce image size
RUN apk del python3 make g++

# Create data directory with correct permissions for database
RUN mkdir -p /data && chown -R claudeuser:claudeuser /data

# Create workspace directory for cloning repos
RUN mkdir -p /workspace && chown -R claudeuser:claudeuser /workspace

# Set permissions for claudeuser
RUN chown -R claudeuser:claudeuser /app

USER claudeuser

EXPOSE 3001
ENTRYPOINT ["docker-entrypoint.sh"]

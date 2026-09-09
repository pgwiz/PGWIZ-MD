# ==========================================
# High-Performance Ultra-Low-Latency Production Dockerfile
# Base: Debian Bookworm Slim (glibc for high-throughput crypto & zero musl lock contention)
# ==========================================

# Stage 1: Build & Compile Native C++ Addons
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install native compilation dependencies for better-sqlite3 and C++ crypto bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for optimal build cache
COPY package*.json ./

# Compile native addons with glibc SIMD optimizations
RUN npm install --legacy-peer-deps --no-audit --no-fund

# ==========================================
# Stage 2: Ultra-Low-Latency Production Runner
# ==========================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install high-performance runtime libraries for media processing & networking
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    webp \
    git \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Performance Environment Optimization:
# - UV_THREADPOOL_SIZE=16: Eliminates libuv thread contention between crypto, sqlite3, and DNS
# - NODE_ENV=production: Enables V8 optimized inline caching
ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=16 \
    PORT=5000 \
    DB_URL="./data/baileys_store.db"

# Copy pre-compiled dependencies from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application source files
COPY . .

# Ensure writable directories for session and database
RUN mkdir -p /app/session /app/data && chmod -R 777 /app/session /app/data

# Expose HTTP healthcheck port
EXPOSE 5000

# Launch with optimized V8 heap (512MB headroom prevents Stop-The-World GC latency spikes)
CMD ["node", "--max-old-space-size=512", "index.js"]

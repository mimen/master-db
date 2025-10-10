FROM oven/bun:1 as builder

WORKDIR /workspace

# Copy convex directory (needed for type imports)
COPY convex ./convex

# Copy app package files
COPY app/package.json app/bun.lock* ./app/

# Install dependencies
WORKDIR /workspace/app
RUN bun install --frozen-lockfile

# Copy app source files
COPY app ./

# Build the app
RUN bun run build

# Production stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /workspace/app/dist ./dist
COPY --from=builder /workspace/app/package.json ./
COPY --from=builder /workspace/app/node_modules ./node_modules

# Expose port (Heroku will set this dynamically)
EXPOSE $PORT

CMD ["bunx", "--bun", "vite", "preview", "--port", "$PORT", "--host", "0.0.0.0"]

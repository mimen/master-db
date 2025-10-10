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

# Install serve for static file hosting
RUN bun add -g serve

# Copy built files
COPY --from=builder /workspace/app/dist ./dist

# Use shell form to properly expand PORT environment variable
CMD serve -s dist -l $PORT

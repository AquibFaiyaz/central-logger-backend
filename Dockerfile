# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install all dependencies (including devDependencies for compilation)
RUN npm ci

# Copy the rest of the source code
COPY . .

# Compile TypeScript
RUN npm run build

# --- Production Stage ---
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy dependency definitions
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy compiled JavaScript output from the builder stage
COPY --from=builder /app/dist ./dist

# Expose port 4000
EXPOSE 4000

# Run the app
CMD ["node", "dist/server.js"]

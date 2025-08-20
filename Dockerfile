# Build frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app/interface
COPY interface/package*.json ./
RUN npm ci
COPY interface/ ./
RUN npm run build

# Backend stage  
FROM node:18-alpine
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy and install backend dependencies
COPY server/package*.json ./
RUN npm ci

# Copy TypeScript source files
COPY server/ ./

# Copy built frontend
COPY --from=frontend-build /app/interface/.svelte-kit/output/client ./public

# Create user data directory (changed from user-data to user)
RUN mkdir -p /app/user

EXPOSE 9000

# Run TypeScript directly with tsx (no compilation)
CMD ["npm", "start"]

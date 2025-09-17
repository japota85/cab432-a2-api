FROM node:22-slim

# Install ffmpeg for video processing
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --omit=dev

# Copy source code
COPY src ./src

# Pre-create uploads directories (your code expects these)
RUN mkdir -p /app/uploads/raw /app/uploads/processed

# Set environment
ENV NODE_ENV=production
EXPOSE 3000

# Start the server
CMD ["node", "src/index.js"]

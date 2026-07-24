FROM node:22-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (production-friendly)
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the application files
COPY . .

# Expose the API port
EXPOSE 3000

# Set default Node environment to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "src/server.js"]

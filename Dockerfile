# Use Node.js LTS version
FROM node:20-alpine

# Install git (required for repo operations)
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application source
COPY . .

# Expose port (default Express port is 3000)
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

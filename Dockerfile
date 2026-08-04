# Use Debian-based Node image (glibc) rather than Alpine — aider's Python
# dependencies (tree-sitter language pack, etc.) ship prebuilt manylinux
# wheels that need glibc; musl (Alpine) forces slow from-source builds and
# some wheels aren't published for musl at all.
FROM node:20-bookworm-slim

# git: required for repo operations.
# python3/pip: required to install aider (a Python CLI, not an npm package).
# ca-certificates: needed for pip/uv to fetch packages over HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install aider itself. aider-install pulls in `uv` and uses it to set up
# aider in an isolated environment — this is the method aider's own docs
# recommend, and avoids fighting Node's dependency tree with Python's.
RUN pip3 install --no-cache-dir --break-system-packages aider-install \
    && aider-install
ENV PATH="/root/.local/bin:${PATH}"

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

FROM node:20-bookworm-slim

# Install Python, pip, git, and build essentials (aider needs these)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install aider into an isolated venv so it doesn't clash with system python
RUN python3 -m venv /opt/aider-venv \
    && /opt/aider-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/aider-venv/bin/pip install --no-cache-dir aider-chat

ENV PATH="/opt/aider-venv/bin:${PATH}"

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Directory where repos get cloned per-request
RUN mkdir -p /app/workspaces

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]

FROM node:20-bookworm-slim

# Install Python, pip, git, and build essentials (aider needs these), plus
# unzip + the runtime libs Godot's Linux binary dynamically links against
# even when only ever run with --headless (it's the same binary as the GUI
# editor — Godot 4.x dropped the separate "headless" build in favor of the
# --headless flag on the standard build).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    unzip \
    ca-certificates \
    build-essential \
    libgl1 \
    libglu1-mesa \
    libxcursor1 \
    libxinerama1 \
    libxrandr2 \
    libxi6 \
    libxrender1 \
    libasound2 \
    libpulse0 \
    libdbus-1-3 \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Install aider into an isolated venv so it doesn't clash with system python
RUN python3 -m venv /opt/aider-venv \
    && /opt/aider-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/aider-venv/bin/pip install --no-cache-dir aider-chat

ENV PATH="/opt/aider-venv/bin:${PATH}"

# Install Godot Engine (headless-capable) from the official GitHub releases
# (the same binaries godotengine.org/download links to). Override
# GODOT_VERSION at build time (--build-arg GODOT_VERSION=4.x) to pin a
# different release; check https://godotengine.org/download/linux/ for the
# current stable version.
ARG GODOT_VERSION=4.7
RUN curl -fSL -o /tmp/godot.zip \
      "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip" \
    && unzip -q /tmp/godot.zip -d /opt/godot \
    && mv "/opt/godot/Godot_v${GODOT_VERSION}-stable_linux.x86_64" /usr/local/bin/godot \
    && chmod +x /usr/local/bin/godot \
    && rm -rf /tmp/godot.zip /opt/godot

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Directory where repos get cloned per-request
RUN mkdir -p /app/workspaces

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]

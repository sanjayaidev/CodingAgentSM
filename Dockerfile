git aFROM node:20-slim

# git: needed to clone/commit user repos
# python3/pip/venv: needed to install and run the aider CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      python3 \
      python3-pip \
      python3-venv \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install aider in its own venv so it can't clash with Node tooling,
# then symlink it onto PATH.
RUN python3 -m venv /opt/aider-venv \
    && /opt/aider-venv/bin/pip install --no-cache-dir aider-chat \
    && ln -s /opt/aider-venv/bin/aider /usr/local/bin/aider

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Repos get cloned here at runtime; keep it out of the app source tree.
RUN mkdir -p /app/workspace
ENV WORKSPACE_DIR=/app/workspace

# Aider needs a git identity even before per-repo config is set.
RUN git config --global user.name "Coding Agent" \
    && git config --global user.email "coding-agent@users.noreply.github.com" \
    && git config --global --add safe.directory '*'

EXPOSE 3000
CMD ["npm", "start"]

FROM node:20

ARG CLAUDE_CODE_VERSION=latest
ARG TZ=Etc/UTC
ENV TZ=$TZ

# System dependencies + Chromium runtime libs for Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    tzdata \
    less git procps sudo fzf zsh man-db unzip gnupg2 gh \
    iptables ipset iproute2 dnsutils aggregate jq nano vim \
    wget ca-certificates fonts-liberation libnss3 libatk-bridge2.0-0 \
    libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libcups2 libxss1 libgtk-3-0 \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# npm global directory for the node user
RUN mkdir -p /usr/local/share/npm-global && chown -R node:node /usr/local/share

ARG USERNAME=node

# Persisted shell history (mounted as a named volume from devcontainer.json)
RUN mkdir /commandhistory && touch /commandhistory/.bash_history \
    && chown -R $USERNAME /commandhistory

ENV DEVCONTAINER=true

# Workspace + Claude config dirs
RUN mkdir -p /workspace /home/node/.claude && chown -R node:node /workspace /home/node/.claude
WORKDIR /workspace

# Install git-delta
ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
    wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

USER node

ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin
ENV SHELL=/bin/zsh
ENV EDITOR=nano
ENV VISUAL=nano

# Zsh + plugins
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
    -p git -p fzf \
    -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
    -a "source /usr/share/doc/fzf/examples/completion.zsh" \
    -x

# Persist bash history into the mounted /commandhistory volume
RUN echo "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
    >> /home/node/.zshrc

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# ---- Bangle.js specific additions ----

# Playwright + Chromium (system deps already installed above as root)
RUN npx -y playwright@latest install chromium

# Static file server (handy for serving the BangleApps emulator locally)
RUN npm install -g http-server

# BangleApps repo (contains the emulator the Playwright tests drive)
RUN git clone --depth 1 https://github.com/espruino/BangleApps.git /home/node/BangleApps

# ---- End Bangle.js additions ----

# Optional: outbound network firewall (Claude Code reference setup).
# To enable, drop init-firewall.sh into .devcontainer/ and uncomment below.
# Source: https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh
# USER root
# COPY init-firewall.sh /usr/local/bin/init-firewall.sh
# RUN chmod +x /usr/local/bin/init-firewall.sh && \
#     echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
#     chmod 0440 /etc/sudoers.d/node-firewall
# USER node

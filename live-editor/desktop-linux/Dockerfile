FROM mcr.microsoft.com/dotnet/sdk:8.0-noble
ENV NODE_VERSION=24.12.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl desktop-file-utils ffmpeg file fonts-noto-cjk git python3 squashfs-tools xz-utils \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; archive="node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    cd /tmp; curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/$archive"; \
    echo "bdebee276e58d0ef5448f3d5ac12c67daa963dd5e0a9bb621a53d1cefbc852fd  $archive" | sha256sum -c -; \
    mkdir /opt/caibo-node; tar -xJf "$archive" --strip-components=1 -C /opt/caibo-node; \
    rm "$archive"
ENV PATH="/opt/caibo-node/bin:${PATH}" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

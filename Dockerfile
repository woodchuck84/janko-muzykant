FROM node:22-bookworm-slim AS frontend-build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM ubuntu:24.04 AS app

ARG AUDIVERIS_VERSION=5.11.0
ENV DEBIAN_FRONTEND=noninteractive \
    JANKO_DATA=/data \
    AUDIVERIS_COMMAND=/opt/audiveris/bin/Audiveris \
    GDK_SCALE=1 \
    JAVA_TOOL_OPTIONS="-Djava.awt.headless=true" \
    HOME=/tmp

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        desktop-file-utils \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation \
        openjdk-21-jre-headless \
        python3.12 \
        python3.12-venv \
        shared-mime-info \
        xdg-utils \
    && curl -fsSL --retry 3 --retry-all-errors --connect-timeout 30 --max-time 300 "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" -o /app/audiveris.deb \
    && mkdir -p /usr/share/applications /usr/share/desktop-directories /usr/share/mime/packages \
    && apt-get install -y --no-install-recommends /app/audiveris.deb \
    && rm -f /app/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python3.12 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY backend ./backend
COPY --from=frontend-build /build/dist ./dist

RUN groupadd --system --gid 10001 janko \
    && useradd --system --uid 10001 --gid janko --home-dir /nonexistent --shell /usr/sbin/nologin janko \
    && mkdir -p /data \
    && chown janko:janko /data

USER 10001:10001
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

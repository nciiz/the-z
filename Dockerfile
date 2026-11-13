FROM node:20-alpine

# ffmpeg و python لـ yt-dlp (تحميل تيك توك/انستا/تويتر)
RUN apk add --no-cache ca-certificates ffmpeg python3 py3-pip openjdk21-jre-headless && pip3 install --no-cache-dir yt-dlp --break-system-packages

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Lavalink with the YouTube source plugin. The node stays loopback-only inside this container.
RUN mkdir -p /app/lavalink
COPY lavalink/application.yml /app/lavalink/application.yml
RUN wget -q https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar -O /app/lavalink/Lavalink.jar

# Copy root package.json + lockfile for workspaces
# (اللوك فايل يجعل تثبيت الحزم حتميًا وقابلًا لإعادة الإنتاج)
COPY package.json package-lock.json ./

# Copy orchestrator entrypoint + shared env helpers
COPY start.js ./
COPY scripts ./scripts/

# Copy fonts
COPY fonts ./fonts/

# Copy shared package
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src

# Copy bot
COPY bot/package.json bot/tsconfig.json ./bot/
COPY bot/src ./bot/src
COPY bot/fonts ./bot/fonts/

# Copy dashboard
COPY dashboard/package.json dashboard/tsconfig.json dashboard/next.config.js dashboard/tailwind.config.ts dashboard/postcss.config.js ./dashboard/
COPY dashboard/src ./dashboard/src
COPY dashboard/public ./dashboard/public

# Install all dependencies using workspaces
# npm ci أولًا (تثبيت مطابق للوك) مع رجوع آمن إلى npm install إن كان الوك غير متزامن
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Build shared
RUN npm run build --workspace=@thez/shared

# Build bot
RUN npm run build --workspace=bot

# Build dashboard
RUN npm run build --workspace=dashboard

# Create certs directory
RUN mkdir -p /app/certs

ENV NODE_ENV=production
ENV PORT=3000

# Orchestrator: health on PORT منذ الثانية 0 ثم deploy → bot → dashboard
CMD ["node", "/app/start.js"]

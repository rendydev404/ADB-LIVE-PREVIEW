# Build: Vite bundle + scrcpy-server (downloaded and checksum-verified by postinstall).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

# Runtime: the site is fully static, so a ~1 MB BusyBox httpd is enough.
# Compression and cache headers are added by the host's Caddy.
FROM busybox:1.37-musl
COPY deploy/httpd.conf /etc/httpd.conf
COPY --from=build /app/dist /www
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["httpd", "-f", "-p", "8080", "-h", "/www", "-c", "/etc/httpd.conf"]

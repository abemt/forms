# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install all workspace dependencies first (cached layer)
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

# Build server and web
COPY server/ server/
COPY web/ web/
RUN npm run build

# Remove dev dependencies, keep production ones only
RUN npm prune --omit=dev && mkdir -p server/node_modules

# ---------- Runtime stage ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist
WORKDIR /app

# LibreOffice renders uploaded .docx templates pixel-exactly; the app falls
# back to a structural re-creation when it is unavailable.
RUN apk add --no-cache libreoffice-writer ttf-liberation font-carlito \
    || apk add --no-cache libreoffice-writer ttf-liberation

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/assets ./server/assets
COPY --from=build /app/web/dist ./web/dist
COPY scripts/merge-docx-forms.mjs ./scripts/merge-docx-forms.mjs
COPY scripts/build-entry-workbook.mjs scripts/site-workbook.mjs scripts/site-workbook-fill.mjs ./scripts/

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME /app/data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "server/dist/index.js"]

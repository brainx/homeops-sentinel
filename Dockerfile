FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS builder

WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=4747
ENV HOMEOPS_DATA_DIR=/data
ENV HOMEOPS_STATIC_DIR=/app/dist

WORKDIR /app
RUN apk upgrade --no-cache libcrypto3 libssl3 \
  && apk add --no-cache su-exec \
  && rm -rf \
    /opt/yarn* \
    /usr/local/bin/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/npm \
  && mkdir -p /data \
  && chown -R node:node /app /data

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node package.json ./
COPY docker/entrypoint.sh /usr/local/bin/homeops-entrypoint
RUN chmod 755 /usr/local/bin/homeops-entrypoint

EXPOSE 4747

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4747/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["homeops-entrypoint"]
CMD ["node", "server/index.js"]

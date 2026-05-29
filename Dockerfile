FROM node:24.16.0-alpine3.23 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production --ignore-scripts

FROM node:24.16.0-alpine3.23

RUN apk add --no-cache tini bash

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules

COPY package.json package-lock.json ./
COPY server ./server
COPY docker-entrypoint.sh index.html annual-summary.html ./

RUN chmod +x docker-entrypoint.sh && \
    addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 5280

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh"]

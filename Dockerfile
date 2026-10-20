# syntax=docker/dockerfile:1
FROM --platform=${BUILDPLATFORM:-linux/amd64} node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --network-timeout=120000

COPY . .
RUN npm run build

FROM --platform=${TARGETPLATFORM:-linux/amd64} node:22-alpine

WORKDIR /app

COPY --from=build /app/.output .output

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]

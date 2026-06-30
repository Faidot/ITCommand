# ITCommand frontend — Next.js (standalone production build)

# ---- builder: install dependencies AND compile in one stage ----
# Installing and building in the same stage avoids copying node_modules across
# stages (whose .bin symlinks can be lost on some Docker storage drivers,
# making `next` "not found"). The `npm ci` layer is still cached on its own
# because it runs before the source is copied in.
FROM node:20-slim AS builder
WORKDIR /app

# Dependencies first (cached unless the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci

# Build the app.
COPY . .
# NEXT_PUBLIC_* values are baked into the browser bundle at build time.
# Defaulting the API base to the relative "/api" keeps the image portable:
# the browser calls whatever origin served the page, and nginx routes /api to
# the backend — so the same image runs on any server without a rebuild.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal image that runs the standalone server ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `output: "standalone"` emits a self-contained server plus a traced subset of
# node_modules. Static assets and the public/ folder are copied alongside it.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]

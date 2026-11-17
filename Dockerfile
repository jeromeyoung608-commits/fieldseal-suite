# FieldSeal Suite — offline-first, zero-dependency static PWA.
# Runtime image contains only Node.js and the repository; no npm install, no network fetch.
FROM node:22-alpine AS runtime
WORKDIR /app
COPY . .
ENV NODE_NO_WARNINGS=1
EXPOSE 8123
# Loopback is intentionally overridden for container access; the app itself never calls the network.
CMD ["node", "cli/bin/serve.mjs", "--host", "0.0.0.0", "--port", "8123"]

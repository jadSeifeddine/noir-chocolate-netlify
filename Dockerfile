FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Uploaded product photos live here — Dokploy mounts a persistent volume
# at this path so redeploys don't wipe what the owner has uploaded.
RUN mkdir -p /app/public/uploads

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]

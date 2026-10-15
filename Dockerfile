# Pixel Kingdoms: single container, serves the game + WebSocket on $PORT (default 8080)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=8080 SAVE_DIR=/data/saves
# saved worlds live here: mount a volume so they survive redeploys (docker run -v pk-saves:/data/saves)
VOLUME /data/saves
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${PORT}/healthz || exit 1
CMD ["node", "server/index.js"]

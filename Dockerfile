FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg turns LINE voice notes (m4a) into Ogg/Opus for the AI (meeting notes)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY board ./board
COPY brand ./brand
COPY knowledge ./knowledge
CMD ["node", "src/index.js"]

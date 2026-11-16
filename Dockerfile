FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY board ./board
COPY brand ./brand
CMD ["node", "src/index.js"]

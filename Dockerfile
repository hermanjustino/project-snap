FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# Cloud Run injects PORT; the app already reads process.env.PORT.
EXPOSE 8080

CMD ["node", "server/index.js"]

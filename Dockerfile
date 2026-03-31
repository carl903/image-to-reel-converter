FROM node:23-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm install

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.ts"]

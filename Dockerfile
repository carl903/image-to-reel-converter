FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm install

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.ts"]

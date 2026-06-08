FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY README.md ./README.md
COPY config.example.json ./config.example.json

ENV HERMES_ROUTER_HOST=0.0.0.0
ENV HERMES_ROUTER_PORT=20128

EXPOSE 20128

CMD ["node", "./src/cli.mjs", "start"]

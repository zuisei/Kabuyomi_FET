FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package.json ./
COPY server.mjs ./
COPY src ./src

USER node

EXPOSE 8080

CMD ["node", "server.mjs"]

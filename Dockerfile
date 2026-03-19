FROM node:18-alpine

WORKDIR /app

COPY server/ ./

RUN npm ci --production

EXPOSE 3000

CMD ["node", "app.js"]

FROM node:18-alpine

WORKDIR /app

COPY server/ ./

RUN npm ci --production && mkdir -p data uploads/media

ENV PORT=7860
ENV NODE_ENV=production
ENV JWT_SECRET=hf-spaces-chatapp-secret-2026

EXPOSE 7860

CMD ["node", "app.js"]

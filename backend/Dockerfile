FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY node_modules/ ./node_modules/
COPY src/ ./src/

EXPOSE 5000

USER node

CMD ["node", "src/index.js"]
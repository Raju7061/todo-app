# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY node_modules/ ./node_modules/
COPY public/ ./public/
COPY src/ ./src/
ARG REACT_APP_API_URL=http://localhost:5000
ENV REACT_APP_API_URL=$REACT_APP_API_URL
RUN npm run build

# Production stage — only Nginx + built files (tiny image)
FROM nginx:1.25-alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
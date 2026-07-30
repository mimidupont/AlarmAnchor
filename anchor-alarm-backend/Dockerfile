FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so Docker layer caching skips npm ci when
# only server.js changed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./

USER node
EXPOSE 8080
CMD ["node", "server.js"]

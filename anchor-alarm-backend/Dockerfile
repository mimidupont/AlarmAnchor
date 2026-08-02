FROM node:22-alpine

# su-exec lets the entrypoint fix ownership of the mounted Fly volume as
# root, then drop back to the unprivileged `node` user to run the server.
RUN apk add --no-cache su-exec

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so Docker layer caching skips npm ci when
# only server.js changed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js snapshot.js docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

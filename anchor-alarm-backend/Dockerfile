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
# Strip CR before making it executable. .gitattributes pins *.sh to LF, but
# that only applies to a fresh checkout — a working tree cloned earlier on
# Windows still holds CRLF, and the build context is the working tree. With
# CRLF the kernel reads the shebang as "/bin/sh\r" and the container exits
# immediately with "no such file or directory", which reads as a mystery
# crash loop rather than a line-ending problem. One sed removes the whole
# class of failure.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

EXPOSE 8080
# Absolute path: exec-form ENTRYPOINT does no PATH lookup, so don't rely on
# the relative path resolving against WORKDIR either.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]

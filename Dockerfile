FROM node:20-alpine
LABEL description="OpenCode Remote - Control AI coding agents from IM platforms"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

ENV NODE_ENV=production

EXPOSE 9080

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["start"]

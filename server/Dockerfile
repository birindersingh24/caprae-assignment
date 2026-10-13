FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY fixtures ./fixtures
ENV PORT=4000 NODE_ENV=production
EXPOSE 4000
VOLUME ["/app/data"]
CMD ["npx", "tsx", "--disable-warning=ExperimentalWarning", "src/index.ts"]

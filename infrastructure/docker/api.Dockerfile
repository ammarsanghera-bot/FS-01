FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY prisma prisma
COPY apps/api apps/api
RUN npm run build -w @marketplace/shared \
  && npm run prisma:generate -w @marketplace/api \
  && npm run build -w @marketplace/api

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/shared /app/packages/shared
COPY --from=build /app/apps/api /app/apps/api
COPY --from=build /app/prisma /app/prisma
COPY --from=build /app/package.json /app/package.json
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]

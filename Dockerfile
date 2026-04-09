FROM node:20-bookworm-slim AS build

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY static ./static
COPY proto ./proto
COPY svelte.config.js tsconfig.json vite.config.ts ./

RUN pnpm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/build ./build
COPY --from=build /app/proto ./proto

ENV HOST=0.0.0.0
ENV PORT=4318

EXPOSE 4318

CMD ["node", "build"]

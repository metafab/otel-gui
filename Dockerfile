FROM node:22-trixie-slim AS build

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml svelte.config.js ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY src ./src
COPY static ./static
COPY proto ./proto
COPY tsconfig.json vite.config.ts ./

RUN pnpm run build

FROM node:22-trixie-slim AS runtime

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/build ./build
COPY --from=build /app/proto ./proto

ENV HOST=0.0.0.0
ENV PORT=4318

EXPOSE 4318

CMD ["node", "build"]

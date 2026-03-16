/// <reference types="vite/client" />

interface ImportMeta {
  readonly env: ImportMetaEnv & { PACKAGE_VERSION: string }
}

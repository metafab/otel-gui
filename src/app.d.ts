// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
interface ImportMeta {
  readonly env: ImportMetaEnv & { PACKAGE_VERSION: string }
}

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {}

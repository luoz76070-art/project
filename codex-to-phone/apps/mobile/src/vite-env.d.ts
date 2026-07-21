/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

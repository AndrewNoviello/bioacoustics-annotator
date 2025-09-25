import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// https://vite.dev/config/
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["rust-melspec-wasm"], // exclude WASM package from optimization
  },
}))

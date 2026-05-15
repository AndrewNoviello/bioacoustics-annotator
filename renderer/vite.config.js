import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

// https://vite.dev/config/
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
  ],
  // Base path for production builds (Electron loads from file://)
  base: './',
  build: {
    outDir: 'dist',
    // Generate source maps for debugging
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      output: {
        // Ensure WASM files are properly handled
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@stores': path.resolve(__dirname, './src/stores'),
    }
  },
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

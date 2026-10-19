import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sitePagesPlugin, SEARCH_ENTRY, SEARCH_SOURCE } from './scripts/site/index.mjs';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), sitePagesPlugin()],
  build: {
    rollupOptions: {
      // The app, plus the search script the generated static pages load
      input: { main: 'index.html', [SEARCH_ENTRY]: SEARCH_SOURCE }
    }
  },
  server: {
    port: 5173,
    host: true
  }
});

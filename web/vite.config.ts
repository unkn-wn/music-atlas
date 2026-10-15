import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { artistIndexPlugin } from './scripts/artist-index-plugin.mjs';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), artistIndexPlugin()],
  server: {
    port: 5173,
    host: true
  }
});

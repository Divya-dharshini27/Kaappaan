import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    // Allows the app to be opened through a Cloudflare quick tunnel
    // (https://xxxx.trycloudflare.com) for temporary mobile testing.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/led': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/lcd': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/all': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/emergency': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true
      },
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true
      }
    }
  }
});

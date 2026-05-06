import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      hmr: true,
      watch: {
        ignored: ['**/data/**'],
      },
      proxy: {
        '/api': {
          target: 'http://rocky-backend:8000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://rocky-backend:8000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});

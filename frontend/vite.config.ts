import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.LOCAL_LLM_URL': JSON.stringify(env.LOCAL_LLM_URL),
      'process.env.LOCAL_LLM_MODEL': JSON.stringify(env.LOCAL_LLM_MODEL),
    },
    optimizeDeps: {
      noDiscovery: true,
      include: ['react', 'react-dom', 'zustand', 'motion/react']
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        '/socket.io': {
          target: 'ws://127.0.0.1:8001',
          ws: true,
          rewrite: (path) => path,
        },
        '/api': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
        },
      },
      hmr: false,
      watch: {
        ignored: ['**/data/**', '**/dev.db*', '**/prisma/migrations/**']
      }
    },
  };
});

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        'onnxruntime-web': 'onnxruntime-web/dist/ort.all.bundle.min.mjs',
      },
    },
    assetsInclude: ['**/*.onnx'],
    optimizeDeps: {
      include: ['@ricky0123/vad-web', 'onnxruntime-web'],
    },
    server: {
      hmr: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
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

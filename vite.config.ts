import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset URLs so the build works from any sub-path (GH Pages)
  base: './',
  server: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});

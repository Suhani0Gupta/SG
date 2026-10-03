import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' lets the built site work from any address, including GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});

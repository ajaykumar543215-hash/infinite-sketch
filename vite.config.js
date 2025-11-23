import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // IMPORTANT: base must be './' for Electron to find assets in the .exe
  base: './', 
  server: {
    port: 5173,
    strictPort: true,
  }
});
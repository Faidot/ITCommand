import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin app is served under the /admin base path in production.
// Dev server runs on port 3001 and is exposed on all interfaces (host:true).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 3001,
    host: true,
  },
  preview: {
    port: 3001,
    host: true,
  },
});

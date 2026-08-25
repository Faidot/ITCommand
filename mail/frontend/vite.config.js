import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for the TeraMailer frontend.
// Dev server runs on port 3000 and is exposed on the network (host: true).
// The backend API is reached via VITE_API_URL (axios), so no dev proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  preview: {
    port: 3000,
    host: true,
  },
});

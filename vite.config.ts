import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // WebXR exige HTTPS: `HTTPS=1 pnpm dev` para abrir la app desde el Quest por Wi-Fi (por USB basta `adb reverse`)
    ...(process.env.HTTPS ? [basicSsl()] : []),
  ],
  // API de seguimiento (server/) en desarrollo
  server: { host: process.env.HTTPS ? true : undefined, proxy: { '/api': 'http://localhost:3001' } },
})

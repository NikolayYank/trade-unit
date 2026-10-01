import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' — собранный dist/ работает из любой папки на сервере
export default defineConfig({ plugins: [react()], base: './' });

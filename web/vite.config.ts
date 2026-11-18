import { defineConfig } from 'vite';

// GitHub Pages serves the site under /<repo>/: relative paths work there and locally
export default defineConfig({ base: './' });

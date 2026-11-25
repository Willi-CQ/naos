import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Native Rolldown chunking is the only form that splits three correctly (docs/research/design-skills.md 4.4).
const kernel = process.env.NAOS_KERNEL ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': kernel,
      '/auth': kernel,
      '/ws': { target: kernel.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Off, or the r3f group drags React in with it, the entry imports that chunk, and three loads on every page. With it off,
          // every shared module needs a home below, or it lands in the entry or in Live and the chunks import each other in a circle.
          includeDependenciesRecursively: false,
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/, priority: 40 },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 30 },
            { name: 'r3f', test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|n8ao|maath|react-reconciler|its-fine|suspend-react|react-use-measure|buffer|base64-js|ieee754|@monogrid)/, priority: 20 },
            { name: 'anim', test: /node_modules[\\/](gsap|@gsap|motion|framer-motion|motion-dom|motion-utils)/, priority: 10 },
          ],
        },
      },
    },
  },
});

import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({base:'/climate/',plugins:[react(),tailwindcss()],server:{host:'0.0.0.0',allowedHosts:true},build:{outDir:'../../climate',emptyOutDir:true,chunkSizeWarningLimit:1700}});

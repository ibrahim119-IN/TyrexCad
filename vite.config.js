import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  // إعدادات Worker
  worker: {
    format: 'es'
  },
  
  // استثناء OpenCASCADE من التحسين
  optimizeDeps: {
    exclude: ['opencascade.js']
  },
  
  // Headers لـ SharedArrayBuffer
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  },
  
  // إعدادات الاختبار
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        ...configDefaults.exclude,
        'scripts/**',
        '**/node_modules/**',
      ]
    },
    exclude: [
      ...configDefaults.exclude,
      'scripts/**',
    ],
    globals: true,
    mockReset: true,
    restoreMocks: true,
  }
});
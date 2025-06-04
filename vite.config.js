import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // بيئة الاختبار
    environment: 'jsdom',
    
    // إعدادات التغطية
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        ...configDefaults.exclude,
        'scripts/**',
        '**/node_modules/**',
      ]
    },
    
    // المجلدات المُستبعدة
    exclude: [
      ...configDefaults.exclude,
      'scripts/**',
    ],
    
    // إعدادات عامة
    globals: true,
    mockReset: true,
    restoreMocks: true,
  }
});
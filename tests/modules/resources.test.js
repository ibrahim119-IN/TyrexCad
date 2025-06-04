/**
 * اختبارات Resources Module
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import ResourcesModule from '../../modules/resources/index.js';

// Mock للـ messageAPI
function createMockMessageAPI() {
  const handlers = new Map();
  
  return {
    emit: vi.fn(),
    on: vi.fn((event, handler) => {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event).push(handler);
    }),
    off: vi.fn(),
    reply: vi.fn(),
    trigger: async (event, data, requestId = null) => {
      const eventHandlers = handlers.get(event) || [];
      for (const handler of eventHandlers) {
        await handler({ event, data, requestId });
      }
    }
  };
}

// Mock global fetch
global.fetch = vi.fn();

describe('ResourcesModule', () => {
  let resources;
  let mockAPI;

  beforeEach(() => {
    mockAPI = createMockMessageAPI();
    resources = new ResourcesModule(mockAPI);
    
    // Reset fetch mock
    fetch.mockReset();
  });

  afterEach(async () => {
    await resources.cleanup();
  });

  describe('Basic Operations', () => {
    test('should initialize correctly', () => {
      expect(resources.version).toBe('1.0.0');
      expect(resources.cache).toBeInstanceOf(Map);
      expect(resources.config.cacheEnabled).toBe(true);
      
      // التحقق من رسالة الجاهزية
      expect(mockAPI.emit).toHaveBeenCalledWith('resources.ready', {
        version: '1.0.0',
        baseUrl: '/'
      });
    });

    test('should handle resources.load for JSON', async () => {
      const mockData = { test: 'data' };
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockData
      });

      await mockAPI.trigger('resources.load', {
        resource: 'config.json',
        type: 'json'
      }, 'req-1');

      expect(fetch).toHaveBeenCalledWith('/config.json', expect.any(Object));
      expect(mockAPI.reply).toHaveBeenCalledWith('req-1', {
        success: true,
        result: expect.objectContaining({
          type: 'json',
          data: mockData
        })
      });
    });

    test('should handle resources.load for text', async () => {
      const mockText = 'Hello World';
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => mockText
      });

      await mockAPI.trigger('resources.load', {
        resource: 'readme.txt',
        type: 'text'
      }, 'req-2');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-2', {
        success: true,
        result: expect.objectContaining({
          type: 'text',
          data: mockText
        })
      });
    });

    test('should handle resources.load for binary', async () => {
      const mockBuffer = new ArrayBuffer(8);
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => mockBuffer
      });

      await mockAPI.trigger('resources.load', {
        resource: 'data.bin',
        type: 'arraybuffer'
      }, 'req-3');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-3', {
        success: true,
        result: expect.objectContaining({
          type: 'arraybuffer',
          data: mockBuffer
        })
      });
    });

    test('should handle resources.getUrl', async () => {
      await mockAPI.trigger('resources.getUrl', {
        resource: 'assets/image.png'
      }, 'req-4');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-4', {
        success: true,
        result: '/assets/image.png'
      });
    });

    test('should handle absolute URLs in getUrl', async () => {
      await mockAPI.trigger('resources.getUrl', {
        resource: 'https://example.com/resource.json'
      }, 'req-5');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-5', {
        success: true,
        result: 'https://example.com/resource.json'
      });
    });
  });

  describe('Cache Functionality', () => {
    test('should cache loaded resources', async () => {
      const mockData = { cached: true };
      fetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockData
      });

      // أول تحميل
      await mockAPI.trigger('resources.load', {
        resource: 'cached.json',
        type: 'json'
      }, 'req-6');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(resources.stats.cacheMisses).toBe(1);

      // ثاني تحميل - من الكاش
      await mockAPI.trigger('resources.load', {
        resource: 'cached.json',
        type: 'json'
      }, 'req-7');

      expect(fetch).toHaveBeenCalledTimes(1); // لم يُستدعى مرة أخرى
      expect(resources.stats.cacheHits).toBe(1);
    });

    test('should clear cache', async () => {
      // إضافة شيء للكاش
      resources.cache.set('test:json', { data: 'test', size: 100 });
      resources.stats.cached = 1;

      await mockAPI.trigger('resources.clearCache', {}, 'req-8');

      expect(resources.cache.size).toBe(0);
      expect(resources.stats.cached).toBe(0);
      expect(mockAPI.reply).toHaveBeenCalledWith('req-8', {
        success: true
      });
    });
  });

  describe('Auto Type Detection', () => {
    test('should auto-detect JSON type', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ auto: 'detected' })
      });

      await mockAPI.trigger('resources.load', {
        resource: 'data.json',
        type: 'auto'
      }, 'req-9');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-9', {
        success: true,
        result: expect.objectContaining({
          type: 'json'
        })
      });
    });

    test('should auto-detect WASM type', async () => {
      const wasmBuffer = new ArrayBuffer(8);
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/wasm' }),
        arrayBuffer: async () => wasmBuffer
      });

      await mockAPI.trigger('resources.load', {
        resource: 'module.wasm',
        type: 'auto'
      }, 'req-10');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-10', {
        success: true,
        result: expect.objectContaining({
          type: 'wasm'
        })
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));
      
      // تقليل المحاولات لتسريع الاختبار
      resources.config.retryAttempts = 1;

      await mockAPI.trigger('resources.load', {
        resource: 'error.json'
      }, 'req-11');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-11', {
        success: false,
        error: 'Network error'
      });
      expect(resources.stats.errors).toBe(1);
    });

    test('should handle 404 errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      
      // تقليل المحاولات لتسريع الاختبار
      resources.config.retryAttempts = 1;

      await mockAPI.trigger('resources.load', {
        resource: 'missing.json'
      }, 'req-12');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-12', {
        success: false,
        error: 'Failed to load resource: 404 Not Found'
      });
    });

    test('should retry on failure', async () => {
      // فشل مرتين ثم نجاح
      fetch
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'Success after retries'
        });

      // تقليل التأخير للاختبار
      resources.config.retryDelay = 10;

      await mockAPI.trigger('resources.load', {
        resource: 'retry.txt',
        type: 'text'
      }, 'req-13');

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(mockAPI.reply).toHaveBeenCalledWith('req-13', {
        success: true,
        result: expect.objectContaining({
          data: 'Success after retries'
        })
      });
    });
  });

  describe('Preload Functionality', () => {
    test('should preload multiple resources', async () => {
      fetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'preloaded'
      });

      await mockAPI.trigger('resources.preload', {
        resources: [
          { path: 'file1.txt', type: 'text' },
          { path: 'file2.txt', type: 'text' }
        ]
      }, 'req-14');

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mockAPI.reply).toHaveBeenCalledWith('req-14', {
        success: true,
        result: [
          { resource: 'file1.txt', success: true },
          { resource: 'file2.txt', success: true }
        ]
      });
    });

    test('should handle partial preload failures', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'success'
        })
        .mockRejectedValueOnce(new Error('Failed to load'));

      resources.config.retryAttempts = 1; // تقليل المحاولات

      await mockAPI.trigger('resources.preload', {
        resources: [
          { path: 'success.txt', type: 'text' },
          { path: 'fail.txt', type: 'text' }
        ]
      }, 'req-15');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-15', {
        success: true,
        result: [
          { resource: 'success.txt', success: true },
          { resource: 'fail.txt', success: false, error: 'Failed to load' }
        ]
      });
    });
  });

  describe('Resource Info', () => {
    test('should provide resource info', async () => {
      // تحميل بعض الموارد
      fetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'test data'
      });

      await resources.loadResource('test.txt', 'text');

      await mockAPI.trigger('resources.info', {}, 'req-16');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-16', {
        success: true,
        result: expect.objectContaining({
          stats: expect.objectContaining({
            loaded: 1,
            totalBytes: expect.any(Number)
          }),
          loadedCount: 1,
          version: '1.0.0'
        })
      });
    });
  });

  describe('Health Check', () => {
    test('should pass health check', async () => {
      const healthy = await resources.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
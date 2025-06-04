/**
 * اختبارات Storage Module
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageModule from '../../modules/storage/index.js';

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
    request: vi.fn(),
    reply: vi.fn(),
    // Helper للاختبار
    trigger: async (event, data, requestId = null) => {
      const eventHandlers = handlers.get(event) || [];
      for (const handler of eventHandlers) {
        await handler({ event, data, requestId });
      }
    }
  };
}

describe('StorageModule', () => {
  let storage;
  let mockAPI;

  beforeEach(() => {
    // تنظيف localStorage و IndexedDB
    localStorage.clear();
    
    mockAPI = createMockMessageAPI();
    storage = new StorageModule(mockAPI);
  });

  afterEach(async () => {
    await storage.cleanup();
  });

  describe('Basic Operations', () => {
    test('should initialize correctly', () => {
      expect(storage.version).toBe('1.0.0');
      expect(storage.provider).toBeDefined();
      expect(storage.cache).toBeInstanceOf(Map);
    });

    test('should handle storage.set', async () => {
      await mockAPI.trigger('storage.set', {
        key: 'test-key',
        value: { data: 'test-value' }
      }, 'req-1');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-1', {
        success: true
      });

      // التحقق من البث
      expect(mockAPI.emit).toHaveBeenCalledWith('storage.changed', 
        expect.objectContaining({
          key: 'test-key',
          value: { data: 'test-value' }
        })
      );
    });

    test('should handle storage.get', async () => {
      // تعيين قيمة أولاً
      await storage.provider.set('test-key', 'test-value');

      await mockAPI.trigger('storage.get', {
        key: 'test-key'
      }, 'req-2');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-2', {
        success: true,
        result: 'test-value'
      });
    });

    test('should handle storage.delete', async () => {
      // تعيين قيمة أولاً
      await storage.provider.set('test-key', 'test-value');

      await mockAPI.trigger('storage.delete', {
        key: 'test-key'
      }, 'req-3');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-3', {
        success: true
      });

      // التحقق من الحذف
      const value = await storage.provider.get('test-key');
      expect(value).toBeUndefined();
    });

    test('should handle storage.list', async () => {
      // إضافة عدة مفاتيح
      await storage.provider.set('prefix:key1', 'value1');
      await storage.provider.set('prefix:key2', 'value2');
      await storage.provider.set('other:key3', 'value3');

      await mockAPI.trigger('storage.list', {
        prefix: 'prefix:'
      }, 'req-4');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-4', {
        success: true,
        result: expect.arrayContaining(['prefix:key1', 'prefix:key2'])
      });
    });

    test('should handle storage.clear', async () => {
      // إضافة بيانات
      await storage.provider.set('key1', 'value1');
      await storage.provider.set('key2', 'value2');

      await mockAPI.trigger('storage.clear', {}, 'req-5');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-5', {
        success: true
      });

      // التحقق من المسح
      const keys = await storage.provider.list();
      expect(keys).toHaveLength(0);
    });
  });

  describe('Cache Functionality', () => {
    test('should cache values', async () => {
      // تعيين قيمة
      await storage.provider.set('cached-key', 'cached-value');

      // أول طلب - من المخزن
      await mockAPI.trigger('storage.get', {
        key: 'cached-key',
        useCache: true
      }, 'req-6');

      expect(storage.stats.cacheMisses).toBe(1);
      expect(storage.stats.cacheHits).toBe(0);

      // ثاني طلب - من الكاش
      await mockAPI.trigger('storage.get', {
        key: 'cached-key',
        useCache: true
      }, 'req-7');

      expect(storage.stats.cacheHits).toBe(1);
    });

    test('should bypass cache when requested', async () => {
      await storage.provider.set('key', 'value');

      // طلب مع كاش
      await mockAPI.trigger('storage.get', {
        key: 'key',
        useCache: true
      }, 'req-8');

      // طلب بدون كاش
      await mockAPI.trigger('storage.get', {
        key: 'key',
        useCache: false
      }, 'req-9');

      expect(storage.stats.cacheMisses).toBe(2);
      expect(storage.stats.cacheHits).toBe(0);
    });
  });

  describe('Transaction Support', () => {
    test('should handle successful transaction', async () => {
      await storage.provider.set('existing', 'old-value');

      await mockAPI.trigger('storage.transaction', {
        operations: [
          { type: 'set', key: 'new-key', value: 'new-value' },
          { type: 'delete', key: 'existing' }
        ]
      }, 'req-10');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-10', {
        success: true,
        result: [{ success: true }, { success: true }]
      });

      // التحقق من التطبيق
      const newValue = await storage.provider.get('new-key');
      expect(newValue).toBe('new-value');
      
      const deletedValue = await storage.provider.get('existing');
      expect(deletedValue).toBeUndefined();
    });

    test('should rollback on failure', async () => {
      const originalProvider = storage.provider;
      
      // إضافة قيمة أصلية
      await storage.provider.set('key1', 'original');

      // Mock provider يفشل في العملية الثانية
      let callCount = 0;
      storage.provider = {
        ...originalProvider,
        get: originalProvider.get.bind(originalProvider),
        set: vi.fn(async (key, value) => {
          callCount++;
          if (callCount === 2) {
            throw new Error('Simulated failure');
          }
          return originalProvider.set(key, value);
        }),
        delete: originalProvider.delete.bind(originalProvider)
      };

      await mockAPI.trigger('storage.transaction', {
        operations: [
          { type: 'set', key: 'key1', value: 'modified' },
          { type: 'set', key: 'key2', value: 'should-fail' }
        ]
      }, 'req-11');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-11', {
        success: false,
        error: 'Simulated failure'
      });

      // يجب أن تعود key1 لقيمتها الأصلية
      const value = await originalProvider.get('key1');
      expect(value).toBe('original');
    });
  });

  describe('Error Handling', () => {
    test('should handle get errors', async () => {
      // Mock provider يرمي خطأ
      storage.provider.get = vi.fn().mockRejectedValue(new Error('Get failed'));

      await mockAPI.trigger('storage.get', {
        key: 'error-key'
      }, 'req-12');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-12', {
        success: false,
        error: 'Get failed'
      });
    });

    test('should handle set errors', async () => {
      storage.provider.set = vi.fn().mockRejectedValue(new Error('Set failed'));

      await mockAPI.trigger('storage.set', {
        key: 'error-key',
        value: 'error-value'
      }, 'req-13');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-13', {
        success: false,
        error: 'Set failed'
      });
    });
  });

  describe('Provider Detection', () => {
    test('should detect web provider by default', () => {
      expect(storage.provider.type).toBe('web');
    });

    test('should detect electron provider when available', () => {
      // محاكاة Electron API
      window.electronAPI = {
        storage: {
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
          list: vi.fn(),
          clear: vi.fn()
        }
      };

      const electronStorage = new StorageModule(mockAPI);
      expect(electronStorage.provider.type).toBe('electron');

      // تنظيف
      delete window.electronAPI;
    });

    test('should fallback to web storage in electron provider', async () => {
      // محاكاة Electron بدون storage API
      window.electronAPI = {};

      const electronStorage = new StorageModule(mockAPI);
      expect(electronStorage.provider.type).toBe('electron');
      
      // يجب أن يعمل بشكل طبيعي مع fallback
      await electronStorage.provider.set('test-key', 'test-value');
      const value = await electronStorage.provider.get('test-key');
      expect(value).toBe('test-value');

      // تنظيف
      delete window.electronAPI;
    });
  });

  describe('Storage Info', () => {
    test('should provide storage info', async () => {
      // عمليات لتحديث الإحصائيات
      await mockAPI.trigger('storage.set', { key: 'k1', value: 'v1' });
      await mockAPI.trigger('storage.get', { key: 'k1' });
      await mockAPI.trigger('storage.delete', { key: 'k1' });

      await mockAPI.trigger('storage.info', {}, 'req-14');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-14', {
        success: true,
        result: expect.objectContaining({
          provider: 'web',
          stats: expect.objectContaining({
            reads: 1,
            writes: 1,
            deletes: 1
          }),
          version: '1.0.0'
        })
      });
    });
  });

  describe('Health Check', () => {
    test('should pass health check', async () => {
      const healthy = await storage.healthCheck();
      expect(healthy).toBe(true);
    });

    test('should fail health check on provider error', async () => {
      storage.provider.set = vi.fn().mockRejectedValue(new Error('Provider error'));
      
      const healthy = await storage.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});
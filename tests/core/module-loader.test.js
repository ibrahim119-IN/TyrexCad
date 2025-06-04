/**
 * اختبارات Module Loader
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModuleLoader } from '../../core/module-loader.js';
import { MessageBus } from '../../core/message-bus.js';
import { LifecycleManager } from '../../core/lifecycle.js';

// Mock module للاختبار
class TestModule {
  constructor(messageAPI) {
    this.messageAPI = messageAPI;
    this.version = '1.0.0';
    this.started = false;
    this.cleaned = false;
  }
  
  start() {
    this.started = true;
  }
  
  cleanup() {
    this.cleaned = true;
  }
}

describe('ModuleLoader', () => {
  let messageLoader;
  let messageBus;
  let lifecycle;

  beforeEach(() => {
    messageBus = new MessageBus({ enableLogging: false });
    lifecycle = new LifecycleManager(messageBus);
    messageLoader = new ModuleLoader(messageBus, lifecycle);
  });

  afterEach(() => {
    messageLoader.cleanup();
    lifecycle.cleanup();
    messageBus.destroy();
  });

  describe('Constructor', () => {
    test('should require MessageBus', () => {
      expect(() => new ModuleLoader()).toThrow('MessageBus is required');
    });

    test('should require LifecycleManager', () => {
      expect(() => new ModuleLoader(messageBus)).toThrow('LifecycleManager is required');
    });

    test('should initialize with correct properties', () => {
      expect(messageLoader.modules).toBeInstanceOf(Map);
      expect(messageLoader.loadOrder).toEqual([]);
      expect(messageLoader.config.moduleTimeout).toBe(10000);
    });
  });

  describe('Module Loading', () => {
    test('should register and load module correctly', async () => {
      // تسجيل نوع الوحدة
      messageLoader.registerModuleType('test', TestModule);
      
      // تحميل الوحدة
      const instance = await messageLoader.loadModule('test');
      
      expect(instance).toBeInstanceOf(TestModule);
      expect(messageLoader.isModuleLoaded('test')).toBe(true);
      expect(instance.started).toBe(true); // lifecycle should start it
    });

    test('should load dynamically if not registered', async () => {
      // في بيئة الاختبار، dynamic import سيفشل
      await expect(messageLoader.loadModule('unregistered'))
        .rejects.toThrow('Failed to load');
    });

    test('should validate module class on registration', () => {
      expect(() => {
        messageLoader.registerModuleType('invalid', 'not a class');
      }).toThrow('must be a class');
    });

    test('should prevent duplicate loading', async () => {
      messageLoader.registerModuleType('test', TestModule);
      await messageLoader.loadModule('test');
      
      await expect(messageLoader.loadModule('test'))
        .rejects.toThrow('already loaded');
    });
  });

  describe('Module Unloading', () => {
    test('should unload module correctly', async () => {
      // إعداد وحدة وهمية
      const mockInstance = new TestModule();
      const moduleInfo = {
        name: 'test',
        instance: mockInstance,
        status: 'loaded'
      };
      
      messageLoader.modules.set('test', moduleInfo);
      messageLoader.loadOrder.push('test');
      
      // Mock lifecycle unregister
      vi.spyOn(lifecycle, 'unregisterModule').mockResolvedValue();
      
      await messageLoader.unloadModule('test');
      
      expect(mockInstance.cleaned).toBe(true);
      expect(messageLoader.modules.has('test')).toBe(false);
      expect(messageLoader.loadOrder).not.toContain('test');
    });

    test('should handle unload of non-existent module', async () => {
      await expect(messageLoader.unloadModule('nonexistent'))
        .rejects.toThrow('not loaded');
    });
  });

  describe('Hot Reload', () => {
    test('should reject reload when disabled', async () => {
      await expect(messageLoader.reloadModule('test'))
        .rejects.toThrow('Hot reload is disabled');
    });

    test('should allow enabling hot reload', () => {
      messageLoader.setHotReload(true);
      expect(messageLoader.config.enableHotReload).toBe(true);
      
      messageLoader.setHotReload(false);
      expect(messageLoader.config.enableHotReload).toBe(false);
    });
  });

  describe('Batch Loading', () => {
    test('should load multiple modules', async () => {
      // Mock loadModule
      let loadedModules = [];
      messageLoader.loadModule = vi.fn(async (name) => {
        if (name === 'failing') {
          throw new Error('Load failed');
        }
        loadedModules.push(name);
      });
      
      const result = await messageLoader.loadModules(['module1', 'module2', 'failing', 'module3']);
      
      expect(result.loaded).toEqual(['module1', 'module2', 'module3']);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].name).toBe('failing');
    });
  });

  describe('Message Handlers', () => {
    test('should handle module.load request', async () => {
      // Mock loadModule
      messageLoader.loadModule = vi.fn().mockResolvedValue({});
      
      const response = await messageBus.request('module.load', {
        name: 'testModule'
      });
      
      expect(response).toEqual({ name: 'testModule', loaded: true });
      expect(messageLoader.loadModule).toHaveBeenCalledWith('testModule');
    });

    test('should handle module.unload request', async () => {
      // Setup
      messageLoader.modules.set('test', { status: 'loaded' });
      messageLoader.unloadModule = vi.fn().mockResolvedValue();
      
      const response = await messageBus.request('module.unload', {
        name: 'test'
      });
      
      expect(response).toEqual({ name: 'test', unloaded: true });
    });

    test('should handle module.list request', async () => {
      // Setup modules
      messageLoader.modules.set('module1', {
        status: 'loaded',
        loadedAt: Date.now(),
        version: '1.0.0'
      });
      messageLoader.modules.set('module2', {
        status: 'loading',
        loadedAt: null,
        version: null
      });
      
      const response = await messageBus.request('module.list', {});
      
      expect(response).toHaveLength(2);
      expect(response[0].name).toBe('module1');
      expect(response[0].status).toBe('loaded');
    });
  });

  describe('Cleanup', () => {
    test('should cleanup all modules in reverse order', async () => {
      // Setup
      const unloadOrder = [];
      messageLoader.unloadModule = vi.fn(async (name) => {
        unloadOrder.push(name);
      });
      
      messageLoader.loadOrder = ['first', 'second', 'third'];
      messageLoader.modules.set('first', {});
      messageLoader.modules.set('second', {});
      messageLoader.modules.set('third', {});
      
      await messageLoader.cleanup();
      
      expect(unloadOrder).toEqual(['third', 'second', 'first']);
      expect(messageLoader.modules.size).toBe(0);
      expect(messageLoader.loadOrder).toEqual([]);
    });
  });
});
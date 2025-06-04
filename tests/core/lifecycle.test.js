/**
 * اختبارات Lifecycle Manager
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { LifecycleManager } from '../../core/lifecycle.js';
import { MessageBus } from '../../core/message-bus.js';

// Mock module للاختبار
class MockModule {
  constructor() {
    this.started = false;
    this.stopped = false;
    this.healthCheckCalls = 0;
  }
  
  async start() {
    this.started = true;
  }
  
  async stop() {
    this.stopped = true;
  }
  
  async healthCheck() {
    this.healthCheckCalls++;
    return true;
  }
}

describe('LifecycleManager', () => {
  let lifecycle;
  let messageBus;

  beforeEach(() => {
    messageBus = new MessageBus({ enableLogging: false });
    lifecycle = new LifecycleManager(messageBus);
    vi.useFakeTimers();
  });

  afterEach(() => {
    lifecycle.cleanup();
    messageBus.destroy();
    vi.useRealTimers();
  });

  describe('Constructor', () => {
    test('should require MessageBus', () => {
      expect(() => new LifecycleManager()).toThrow('MessageBus is required');
    });

    test('should initialize with correct properties', () => {
      expect(lifecycle.modules).toBeInstanceOf(Map);
      expect(lifecycle.isShuttingDown).toBe(false);
      expect(lifecycle.config.healthCheckInterval).toBe(5000);
    });
  });

  describe('Module Registration', () => {
    test('should register module successfully', async () => {
      const module = new MockModule();
      
      lifecycle.registerModule('test', module);
      
      expect(lifecycle.modules.has('test')).toBe(true);
      
      // انتظار البدء المؤجل
      await vi.waitFor(() => {
        expect(module.started).toBe(true);
      });
    });

    test('should prevent duplicate registration', () => {
      const module = new MockModule();
      lifecycle.registerModule('test', module);
      
      expect(() => {
        lifecycle.registerModule('test', module);
      }).toThrow('already registered');
    });

    test('should emit registration event', () => {
      const eventHandler = vi.fn();
      messageBus.on('lifecycle.moduleRegistered', eventHandler);
      
      lifecycle.registerModule('test', new MockModule());
      
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'test' }
        })
      );
    });
  });

  describe('Module Lifecycle', () => {
    test('should start module correctly', async () => {
      const module = new MockModule();
      lifecycle.modules.set('test', {
        name: 'test',
        instance: module,
        status: 'initialized',
        errors: []
      });
      
      await lifecycle.startModule('test');
      
      expect(module.started).toBe(true);
      const moduleInfo = lifecycle.modules.get('test');
      expect(moduleInfo.status).toBe('running');
      expect(moduleInfo.startedAt).toBeTruthy();
    });

    test('should stop module correctly', async () => {
      const module = new MockModule();
      lifecycle.modules.set('test', {
        name: 'test',
        instance: module,
        status: 'running'
      });
      
      await lifecycle.stopModule('test');
      
      expect(module.stopped).toBe(true);
      const moduleInfo = lifecycle.modules.get('test');
      expect(moduleInfo.status).toBe('stopped');
    });

    test('should handle module without lifecycle methods', async () => {
      const simpleModule = {}; // No start/stop methods
      lifecycle.modules.set('simple', {
        name: 'simple',
        instance: simpleModule,
        status: 'initialized',
        errors: []
      });
      
      await expect(lifecycle.startModule('simple')).resolves.not.toThrow();
      await expect(lifecycle.stopModule('simple')).resolves.not.toThrow();
    });
  });

  describe('Health Checks', () => {
    test('should perform health checks periodically', async () => {
      const module = new MockModule();
      lifecycle.registerModule('test', module);
      
      // انتظار البدء
      await vi.waitFor(() => {
        expect(lifecycle.modules.get('test').status).toBe('running');
      });
      
      // تقدم الوقت لـ health check interval
      vi.advanceTimersByTime(5000);
      
      // انتظار اكتمال health check
      await vi.waitFor(() => {
        expect(module.healthCheckCalls).toBeGreaterThan(0);
      });
    });

    test('should handle unhealthy modules', async () => {
      const unhealthyModule = {
        healthCheck: async () => false,
        autoRestart: false
      };
      
      lifecycle.modules.set('unhealthy', {
        name: 'unhealthy',
        instance: unhealthyModule,
        status: 'running',
        lastHealthCheck: null,
        errors: []
      });
      
      const eventHandler = vi.fn();
      messageBus.on('lifecycle.moduleUnhealthy', eventHandler);
      
      await lifecycle.performHealthChecks();
      
      expect(eventHandler).toHaveBeenCalled();
      const moduleInfo = lifecycle.modules.get('unhealthy');
      expect(moduleInfo.healthStatus).toBe('unhealthy');
    });
  });

  describe('System Status', () => {
    test('should return correct system status', () => {
      lifecycle.modules.set('module1', {
        status: 'running',
        healthStatus: 'healthy',
        startedAt: Date.now(),
        lastHealthCheck: Date.now(),
        errors: []
      });
      
      lifecycle.modules.set('module2', {
        status: 'error',
        healthStatus: 'unhealthy',
        startedAt: null,
        lastHealthCheck: null,
        errors: [{ message: 'test error' }]
      });
      
      const status = lifecycle.getSystemStatus();
      
      expect(status.moduleCount).toBe(2);
      expect(status.healthyModules).toBe(1);
      expect(status.modules.module1.status).toBe('running');
      expect(status.modules.module2.errorCount).toBe(1);
    });
  });

  describe('System Shutdown', () => {
    test('should shutdown all modules', async () => {
      const module1 = new MockModule();
      const module2 = new MockModule();
      
      lifecycle.registerModule('module1', module1);
      lifecycle.registerModule('module2', module2);
      
      await lifecycle.shutdown();
      
      expect(lifecycle.isShuttingDown).toBe(true);
      expect(module1.stopped).toBe(true);
      expect(module2.stopped).toBe(true);
    });

    test('should stop modules in reverse order', async () => {
      const stopOrder = [];
      
      for (let i = 1; i <= 3; i++) {
        const module = {
          stop: async () => {
            stopOrder.push(i);
          }
        };
        lifecycle.modules.set(`module${i}`, {
          name: `module${i}`,
          instance: module,
          status: 'running'
        });
      }
      
      await lifecycle.shutdown();
      
      expect(stopOrder).toEqual([3, 2, 1]);
    });
  });

  describe('Message Handlers', () => {
    test('should handle lifecycle.status request', async () => {
      lifecycle.registerModule('test', new MockModule());
      
      const response = await messageBus.request('lifecycle.status', {});
      
      expect(response.moduleCount).toBe(1);
      expect(response.modules.test).toBeDefined();
    });

    test('should handle system.shutdown event', () => {
      vi.spyOn(lifecycle, 'shutdown').mockImplementation(() => {});
      
      messageBus.emit('system.shutdown', {});
      
      expect(lifecycle.shutdown).toHaveBeenCalled();
    });
  });

  describe('Restart Functionality', () => {
    test('should attempt module restart on failure', async () => {
      const module = {
        start: vi.fn().mockRejectedValueOnce(new Error('Start failed'))
                     .mockResolvedValueOnce()
      };
      
      lifecycle.modules.set('failing', {
        name: 'failing',
        instance: module,
        status: 'initialized',
        errors: []
      });
      
      await lifecycle.startModule('failing');
      
      // انتظار restart delay
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      
      expect(module.start).toHaveBeenCalledTimes(2);
    });

    test('should limit restart attempts', async () => {
      lifecycle.config.maxRestartAttempts = 2;
      lifecycle.restartAttempts.set('failing', 2);
      
      // إضافة وحدة للسجل
      lifecycle.modules.set('failing', {
        name: 'failing',
        status: 'error',
        instance: {},
        errors: []
      });
      
      await lifecycle.attemptRestart('failing');
      
      const moduleInfo = lifecycle.modules.get('failing');
      expect(moduleInfo?.status).toBe('failed');
    });
  });
});
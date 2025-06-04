/**
 * Message Bus - قلب نظام TyrexCad
 * 
 * النسخة النهائية المحسنة للإنتاج
 * 
 * هذا هو المكون الأساسي الذي يدير جميع الاتصالات في النظام.
 * لا يعرف شيئاً عن محتوى الرسائل، فقط ينقلها بكفاءة عالية.
 */

import { v4 as uuidv4 } from 'uuid';

export class MessageBus {
  constructor(config = {}) {
    // مخزن المستمعين
    this.listeners = new Map();
    
    // مخزن الطلبات المعلقة
    this.pendingRequests = new Map();
    
    // مخزن handlers المسجلة لمنع التكرار
    this.handlerRegistry = new WeakMap();
    
    // إحصائيات الأداء
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesDropped: 0,
      requestsSent: 0,
      requestsCompleted: 0,
      requestsTimedOut: 0,
      requestsFailed: 0,
      largeMessagesWarnings: 0,
      errorsCaught: 0,
      startTime: Date.now(),
      peakListeners: 0,
      peakPendingRequests: 0
    };
    
    // إعدادات النظام
    this.config = {
      defaultTimeout: 5000,
      maxTimeout: 60000,
      enableLogging: false,
      enableMetrics: true,
      maxListenersPerEvent: 1000,
      maxDataSize: 2 * 1024 * 1024,
      warnDataSize: 1024 * 1024,
      maxPendingRequests: 5000,
      enableDuplicateHandlerCheck: true,
      enablePriorityQueue: false, // معطل افتراضياً للتبسيط
      queueProcessingDelay: 0,
      maxQueueSize: 50000,
      dropPolicy: 'low-priority',
      batchSize: 200,
      maxProcessingTime: 8,
      enableBackpressure: true,
      backpressureThreshold: 0.7,
      productionMode: false,
      adaptiveProcessing: true,
      priorityBoost: true,
      ...config
    };
    
    // قوائم انتظار حسب الأولوية
    this.messageQueues = {
      high: [],
      normal: [],
      low: []
    };
    
    // معالج قوائم الانتظار
    this.isProcessingQueue = false;
    
    // pattern cache
    this.patternCache = new Map();
    
    // مؤشرات الضغط
    this.pressure = {
      level: 0,
      dropped: 0,
      lastCheck: Date.now(),
      adaptiveMultiplier: 1
    };
    
    // Stats cache
    this._statsCache = null;
  }

  /**
   * تسجيل مستمع لحدث معين
   */
  on(eventPattern, handler, options = {}) {
    if (typeof eventPattern !== 'string' || !eventPattern) {
      throw new TypeError('Event pattern must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }
    if (eventPattern.length > 256) {
      throw new RangeError('Event pattern too long (max 256 characters)');
    }

    const handlerId = Symbol('handler');
    
    // التحقق من التكرار
    if (this.config.enableDuplicateHandlerCheck) {
      if (this.handlerRegistry.has(handler)) {
        const registeredPatterns = this.handlerRegistry.get(handler);
        if (registeredPatterns.has(eventPattern)) {
          if (this.config.enableLogging) {
            console.warn(`Handler already registered for pattern: ${eventPattern}`);
          }
          return () => {};
        }
        registeredPatterns.add(eventPattern);
      } else {
        this.handlerRegistry.set(handler, new Set([eventPattern]));
      }
    }

    if (!this.listeners.has(eventPattern)) {
      this.listeners.set(eventPattern, new Map());
    }

    const listenersMap = this.listeners.get(eventPattern);
    
    if (listenersMap.size >= this.config.maxListenersPerEvent) {
      const error = new Error(`Maximum listeners (${this.config.maxListenersPerEvent}) reached for pattern: ${eventPattern}`);
      this.emit('system.error', { type: 'maxListeners', pattern: eventPattern, error: error.message });
      throw error;
    }

    const listenerInfo = {
      handler,
      priority: options.priority || 'normal',
      once: options.once || false,
      addedAt: Date.now(),
      callCount: 0,
      totalExecutionTime: 0,
      lastExecutionTime: 0
    };
    
    listenersMap.set(handlerId, listenerInfo);
    
    const totalListeners = this.getTotalListenerCount();
    if (totalListeners > this.stats.peakListeners) {
      this.stats.peakListeners = totalListeners;
    }

    return () => {
      const listeners = this.listeners.get(eventPattern);
      if (listeners) {
        listeners.delete(handlerId);
        if (listeners.size === 0) {
          this.listeners.delete(eventPattern);
        }
      }
      
      if (this.config.enableDuplicateHandlerCheck && this.handlerRegistry.has(handler)) {
        const patterns = this.handlerRegistry.get(handler);
        patterns.delete(eventPattern);
        if (patterns.size === 0) {
          this.handlerRegistry.delete(handler);
        }
      }
    };
  }

  once(eventPattern, handler) {
    return this.on(eventPattern, handler, { once: true });
  }

  off(eventPattern, handler) {
    const listeners = this.listeners.get(eventPattern);
    if (!listeners) return;
    
    for (const [handlerId, info] of listeners.entries()) {
      if (info.handler === handler) {
        listeners.delete(handlerId);
        break;
      }
    }
    
    if (listeners.size === 0) {
      this.listeners.delete(eventPattern);
    }
  }

  /**
   * إرسال رسالة/حدث
   */
  emit(event, data = {}, options = {}) {
    if (typeof event !== 'string' || !event) {
      throw new TypeError('Event must be a non-empty string');
    }
    
    // التحقق من حجم البيانات
    const dataSize = this.estimateSize(data);
    if (dataSize > this.config.maxDataSize) {
      this.stats.messagesDropped++;
      const error = new Error(`Data size (${dataSize} bytes) exceeds maximum (${this.config.maxDataSize} bytes)`);
      this.emit('system.error', { type: 'dataSize', event, size: dataSize, error: error.message });
      throw error;
    }
    
    if (dataSize > this.config.warnDataSize) {
      this.stats.largeMessagesWarnings++;
      if (this.config.enableLogging) {
        console.warn(`Large message warning: ${event} has ${dataSize} bytes of data`);
      }
    }

    // تسجيل الرسالة
    this.stats.messagesSent++;

    const message = {
      event,
      data,
      timestamp: Date.now(),
      id: uuidv4(),
      priority: options.priority || 'normal',
      ...options
    };

    if (this.config.enableLogging) {
      console.log(`📤 Message emitted:`, { 
        event, 
        priority: message.priority,
        dataSize: `${(dataSize / 1024).toFixed(2)}KB`
      });
    }

    // معالجة مباشرة أو عبر القوائم
    if (this.config.enablePriorityQueue) {
      this.enqueueMessage(message);
      
      if (!this.isProcessingQueue) {
        // معالجة فورية في الدورة التالية
        Promise.resolve().then(() => this.processMessageQueues());
      }
    } else {
      // معالجة فورية
      this.deliverMessage(message);
    }

    return message.id;
  }

  enqueueMessage(message) {
    const priority = message.priority || 'normal';
    const queue = this.messageQueues[priority] || this.messageQueues.normal;
    
    this.updatePressureLevel();
    
    if (this.config.enableBackpressure && this.pressure.level > this.config.backpressureThreshold) {
      if (priority === 'low' && this.pressure.level > 0.9) {
        this.pressure.dropped++;
        this.stats.messagesDropped++;
        return;
      }
    }
    
    if (queue.length >= this.config.maxQueueSize) {
      this.applyDropPolicy(queue, priority, message);
      return;
    }
    
    queue.push(message);
  }
  
  applyDropPolicy(queue, priority, message) {
    switch (this.config.dropPolicy) {
      case 'oldest':
        queue.shift();
        queue.push(message);
        break;
      case 'newest':
        this.pressure.dropped++;
        this.stats.messagesDropped++;
        return;
      case 'low-priority':
        let dropped = false;
        
        if (priority === 'high') {
          if (this.messageQueues.low.length > 0) {
            this.messageQueues.low.shift();
            dropped = true;
          } else if (this.messageQueues.normal.length > 0) {
            this.messageQueues.normal.shift();
            dropped = true;
          }
        } else if (priority === 'normal' && this.messageQueues.low.length > 0) {
          this.messageQueues.low.shift();
          dropped = true;
        }
        
        if (dropped) {
          queue.push(message);
        } else {
          queue.shift();
          queue.push(message);
        }
        break;
    }
    
    this.pressure.dropped++;
    this.stats.messagesDropped++;
  }
  
  updatePressureLevel() {
    const now = Date.now();
    if (now - this.pressure.lastCheck < 100) return;
    
    const totalQueued = this.getTotalQueueSize();
    const maxCapacity = this.config.maxQueueSize * 3;
    
    this.pressure.level = Math.min(1, totalQueued / maxCapacity);
    
    const dropRate = this.pressure.dropped / Math.max(1, this.stats.messagesSent);
    
    if (dropRate > 0.1) {
      this.pressure.level = Math.min(1, this.pressure.level + 0.2);
    }
    
    if (this.config.adaptiveProcessing) {
      if (this.pressure.level < 0.3) {
        this.pressure.adaptiveMultiplier = 1.5;
      } else if (this.pressure.level < 0.7) {
        this.pressure.adaptiveMultiplier = 1.0;
      } else {
        this.pressure.adaptiveMultiplier = 0.7;
      }
    }
    
    this.pressure.lastCheck = now;
  }

  processMessageQueues() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    const processAllMessages = () => {
      while (this.hasMessagesInQueues()) {
        let message = null;
        
        if (this.messageQueues.high.length > 0) {
          message = this.messageQueues.high.shift();
        } else if (this.messageQueues.normal.length > 0) {
          message = this.messageQueues.normal.shift();
        } else if (this.messageQueues.low.length > 0) {
          message = this.messageQueues.low.shift();
        }
        
        if (message) {
          this.deliverMessage(message);
        }
      }
      
      this.isProcessingQueue = false;
    };
    
    // معالجة فورية
    processAllMessages();
  }

  /**
   * توصيل رسالة للمستمعين
   */
  deliverMessage(message) {
    const matchingHandlers = this.findMatchingHandlers(message.event);
    
    const sortedHandlers = matchingHandlers.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    sortedHandlers.forEach(handlerInfo => {
      try {
        handlerInfo.callCount++;
        const executionStart = performance.now();
        
        handlerInfo.handler(message);
        this.stats.messagesReceived++;
        
        const executionTime = performance.now() - executionStart;
        handlerInfo.lastExecutionTime = executionTime;
        handlerInfo.totalExecutionTime += executionTime;
        
        if (executionTime > 50 && this.config.enableLogging) {
          console.warn(`Slow handler detected for ${message.event}: ${executionTime.toFixed(2)}ms`);
        }
        
        if (handlerInfo.once) {
          this.removeHandlerInfo(handlerInfo, message.event);
        }
      } catch (error) {
        this.stats.errorsCaught++;
        console.error(`Error in message handler for ${message.event}:`, error);
        
        if (message.event !== 'system.error') {
          Promise.resolve().then(() => {
            this.emit('system.error', {
              originalEvent: message.event,
              error: error.message,
              stack: error.stack,
              handlerInfo: {
                priority: handlerInfo.priority,
                callCount: handlerInfo.callCount,
                avgExecutionTime: handlerInfo.callCount > 0 
                  ? (handlerInfo.totalExecutionTime / handlerInfo.callCount).toFixed(2) 
                  : 0
              }
            }, { priority: 'high' });
          });
        }
      }
    });
  }

  /**
   * إرسال طلب وانتظار الرد
   */
  request(event, data = {}, timeout = null) {
    if (this.pendingRequests.size >= this.config.maxPendingRequests) {
      this.stats.requestsFailed++;
      return Promise.reject(new Error(`Maximum pending requests (${this.config.maxPendingRequests}) reached`));
    }

    return new Promise((resolve, reject) => {
      const requestId = uuidv4();
      const timeoutMs = Math.min(
        timeout || this.config.defaultTimeout,
        this.config.maxTimeout
      );
      
      this.stats.requestsSent++;
      
      if (this.pendingRequests.size + 1 > this.stats.peakPendingRequests) {
        this.stats.peakPendingRequests = this.pendingRequests.size + 1;
      }

      const timeoutHandle = setTimeout(() => {
        const request = this.pendingRequests.get(requestId);
        if (request) {
          this.pendingRequests.delete(requestId);
          this.stats.requestsTimedOut++;
          reject(new Error(`Request timeout for ${event} after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeoutHandle,
        event,
        startTime: Date.now(),
        timeout: timeoutMs
      });

      this.emit(event, data, { requestId, priority: 'high' });
    });
  }

  /**
   * الرد على طلب
   */
  reply(requestId, response) {
    if (!requestId || typeof requestId !== 'string') {
      if (this.config.enableLogging) {
        console.warn('Invalid requestId provided to reply');
      }
      return;
    }

    const pendingRequest = this.pendingRequests.get(requestId);
    
    if (!pendingRequest) {
      if (this.config.enableLogging) {
        console.warn(`No pending request found for ID: ${requestId}`);
      }
      return;
    }

    clearTimeout(pendingRequest.timeoutHandle);
    
    const responseTime = Date.now() - pendingRequest.startTime;
    
    this.pendingRequests.delete(requestId);
    
    if (response && response.success) {
      this.stats.requestsCompleted++;
      pendingRequest.resolve(response.result);
    } else {
      this.stats.requestsFailed++;
      pendingRequest.reject(new Error(response?.error || 'Request failed'));
    }

    if (responseTime > pendingRequest.timeout * 0.8 && this.config.enableLogging) {
      console.warn(`Slow request: ${pendingRequest.event} took ${responseTime}ms`);
    }
    
    if (this.config.enableMetrics) {
      this.emit('system.metrics.request', {
        event: pendingRequest.event,
        responseTime,
        success: response?.success || false
      }, { priority: 'low' });
    }
  }

  findMatchingHandlers(event) {
    const handlers = [];

    this.listeners.forEach((listenersMap, pattern) => {
      if (this.eventMatchesPattern(event, pattern)) {
        listenersMap.forEach(handlerInfo => {
          handlers.push(handlerInfo);
        });
      }
    });

    return handlers;
  }

  eventMatchesPattern(event, pattern) {
    if (event === pattern) return true;
    if (pattern === '*') return true;
    
    let regex = this.patternCache.get(pattern);
    if (!regex) {
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      
      regex = new RegExp(`^${regexPattern}$`);
      
      if (this.config.productionMode && this.patternCache.size > 10000) {
        const entriesToDelete = Math.floor(this.patternCache.size / 2);
        const keys = Array.from(this.patternCache.keys());
        for (let i = 0; i < entriesToDelete; i++) {
          this.patternCache.delete(keys[i]);
        }
      }
      
      this.patternCache.set(pattern, regex);
    }
    
    return regex.test(event);
  }

  estimateSize(obj) {
    try {
      return JSON.stringify(obj).length;
    } catch (e) {
      return 0;
    }
  }

  removeHandlerInfo(handlerInfo, eventPattern) {
    this.listeners.forEach((listenersMap, pattern) => {
      if (this.eventMatchesPattern(eventPattern, pattern)) {
        listenersMap.forEach((info, handlerId) => {
          if (info === handlerInfo) {
            listenersMap.delete(handlerId);
            if (listenersMap.size === 0) {
              this.listeners.delete(pattern);
            }
          }
        });
      }
    });
  }

  getTotalListenerCount() {
    let count = 0;
    this.listeners.forEach(listenersMap => {
      count += listenersMap.size;
    });
    return count;
  }

  hasMessagesInQueues() {
    return this.messageQueues.high.length > 0 ||
           this.messageQueues.normal.length > 0 ||
           this.messageQueues.low.length > 0;
  }

  getTotalQueueSize() {
    return this.messageQueues.high.length +
           this.messageQueues.normal.length +
           this.messageQueues.low.length;
  }

  getStats() {
    const now = Date.now();
    
    // Cache stats for 100ms
    if (this._statsCache && now - this._statsCache.time < 100) {
      return this._statsCache.data;
    }
    
    const uptime = now - this.stats.startTime;
    const messagesPerSecond = this.stats.messagesSent / (uptime / 1000);
    const successRate = this.stats.requestsSent > 0 
      ? (this.stats.requestsCompleted / this.stats.requestsSent * 100).toFixed(2)
      : 100;
    
    const processingRate = this.stats.messagesReceived / (uptime / 1000);
    
    const dropRate = this.stats.messagesSent > 0
      ? (this.stats.messagesDropped / this.stats.messagesSent * 100).toFixed(2)
      : 0;
    
    let avgHandlerExecutionTime = 0;
    let slowHandlersCount = 0;
    this.listeners.forEach(listenersMap => {
      listenersMap.forEach(handlerInfo => {
        if (handlerInfo.callCount > 0) {
          const avg = handlerInfo.totalExecutionTime / handlerInfo.callCount;
          avgHandlerExecutionTime += avg;
          if (avg > 50) slowHandlersCount++;
        }
      });
    });
    
    const totalHandlers = this.getTotalListenerCount();
    if (totalHandlers > 0) {
      avgHandlerExecutionTime = avgHandlerExecutionTime / totalHandlers;
    }
    
    const statsData = {
      ...this.stats,
      uptime,
      uptimeHuman: this.formatUptime(uptime),
      messagesPerSecond: messagesPerSecond.toFixed(2),
      processingRate: processingRate.toFixed(2),
      pendingRequests: this.pendingRequests.size,
      totalListeners: totalHandlers,
      queueSizes: {
        high: this.messageQueues.high.length,
        normal: this.messageQueues.normal.length,
        low: this.messageQueues.low.length,
        total: this.getTotalQueueSize()
      },
      pressure: {
        level: Math.round(this.pressure.level * 100) + '%',
        dropped: this.pressure.dropped,
        isUnderPressure: this.pressure.level > this.config.backpressureThreshold,
        adaptiveMultiplier: this.pressure.adaptiveMultiplier?.toFixed(2) || '1.00'
      },
      performance: {
        dropRate: dropRate + '%',
        requestSuccessRate: successRate + '%',
        queueUtilization: Math.round((this.getTotalQueueSize() / (this.config.maxQueueSize * 3)) * 100) + '%',
        avgHandlerExecutionTime: avgHandlerExecutionTime.toFixed(2) + 'ms',
        slowHandlersCount
      },
      health: this.calculateHealth(),
      mode: this.config.productionMode ? 'production' : 'development'
    };
    
    this._statsCache = { data: statsData, time: now };
    return statsData;
  }

  calculateHealth() {
    const factors = [];
    
    if (this.stats.requestsSent > 0) {
      const successRate = this.stats.requestsCompleted / this.stats.requestsSent;
      factors.push(successRate);
    } else {
      factors.push(1);
    }
    
    const errorRate = this.stats.messagesSent > 0 
      ? 1 - (this.stats.errorsCaught / this.stats.messagesSent)
      : 1;
    factors.push(errorRate);
    
    const queueHealth = 1 - (this.getTotalQueueSize() / (this.config.maxQueueSize * 3));
    factors.push(Math.max(0, queueHealth));
    
    const pendingHealth = 1 - (this.pendingRequests.size / this.config.maxPendingRequests);
    factors.push(Math.max(0, pendingHealth));
    
    const dropHealth = this.stats.messagesSent > 0
      ? 1 - (this.stats.messagesDropped / this.stats.messagesSent)
      : 1;
    factors.push(Math.max(0, dropHealth));
    
    const health = factors.reduce((a, b) => a + b, 0) / factors.length * 100;
    return Math.round(health);
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  setLogging(enabled) {
    this.config.enableLogging = enabled;
  }
  
  static getProductionConfig() {
    return {
      maxQueueSize: 50000,
      batchSize: 200,
      maxProcessingTime: 8,
      enableBackpressure: true,
      backpressureThreshold: 0.7,
      dropPolicy: 'low-priority',
      maxDataSize: 2 * 1024 * 1024,
      maxPendingRequests: 5000,
      maxListenersPerEvent: 1000,
      enablePriorityQueue: true,
      queueProcessingDelay: 0,
      productionMode: true,
      adaptiveProcessing: true,
      priorityBoost: true,
      enableMetrics: true,
      enableLogging: false
    };
  }

  destroy() {
    this.config.productionMode = false;
    this.isProcessingQueue = false;
    
    this.pendingRequests.forEach((request, id) => {
      clearTimeout(request.timeoutHandle);
      request.reject(new Error('Message bus destroyed'));
    });
    
    this.listeners.clear();
    this.pendingRequests.clear();
    this.handlerRegistry = new WeakMap();
    this.messageQueues.high.length = 0;
    this.messageQueues.normal.length = 0;
    this.messageQueues.low.length = 0;
    
    if (this.patternCache) {
      this.patternCache.clear();
    }
    
    // Clear stats cache
    this._statsCache = null;
    
    if (this.config.enableLogging) {
      console.log('Message Bus destroyed safely');
    }
  }
}

export function createMessageAPI(messageBus, moduleName) {
  if (!messageBus || !(messageBus instanceof MessageBus)) {
    throw new TypeError('Valid MessageBus instance required');
  }
  if (!moduleName || typeof moduleName !== 'string') {
    throw new TypeError('Module name must be a non-empty string');
  }

  return {
    emit: (event, data, options) => 
      messageBus.emit(event, data, { ...options, source: moduleName }),
    
    on: (pattern, handler, options) => 
      messageBus.on(pattern, handler, options),
    
    once: (pattern, handler) => 
      messageBus.once(pattern, handler),
    
    off: (pattern, handler) => 
      messageBus.off(pattern, handler),
    
    request: (event, data, timeout) => 
      messageBus.request(event, data, timeout),
    
    reply: (requestId, response) => 
      messageBus.reply(requestId, response),
    
    getStats: () => messageBus.getStats()
  };
}
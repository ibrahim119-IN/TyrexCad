/**
 * OCCT Module
 * 
 * يدير Web Workers لتنفيذ عمليات OpenCASCADE
 * جميع العمليات تتم في workers منفصلة لعدم حجب الواجهة
 */

export default class OCCTModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    
    // Worker pool configuration
    this.minWorkers = 2;
    this.maxWorkers = navigator.hardwareConcurrency || 4;
    this.workers = [];
    this.availableWorkers = [];
    this.busyWorkers = new Map(); // taskId -> worker
    
    // Task management
    this.taskQueue = [];
    this.activeTasks = new Map();
    this.taskIdCounter = 0;
    
    // Performance monitoring
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageTime: 0,
      workerCrashes: 0,
      initFailures: 0
    };
    
    // الحالة
    this.state = {
      initialized: false,
      initializing: false,
      lastError: null
    };
    
    this.setupHandlers();
    this.initializeWorkerPool();
  }
  
  /**
   * إعداد معالجات الرسائل
   */
  setupHandlers() {
    // عمليات الأشكال الأساسية
    this.msg.on('occt.createBox', this.handleCreateBox.bind(this));
    this.msg.on('occt.createSphere', this.handleCreateSphere.bind(this));
    this.msg.on('occt.createCylinder', this.handleCreateCylinder.bind(this));
    this.msg.on('occt.createCone', this.handleCreateCone.bind(this));
    this.msg.on('occt.createTorus', this.handleCreateTorus.bind(this));
    
    // عمليات Boolean
    this.msg.on('occt.boolean', this.handleBoolean.bind(this));
    
    // عمليات التحويل
    this.msg.on('occt.transform', this.handleTransform.bind(this));
    this.msg.on('occt.toMesh', this.handleToMesh.bind(this));
    
    // عمليات القياس والتحليل
    this.msg.on('occt.measure', this.handleMeasure.bind(this));
    
    // عمليات التعديل
    this.msg.on('occt.fillet', this.handleFillet.bind(this));
    this.msg.on('occt.chamfer', this.handleChamfer.bind(this));
    
    // عمليات البثق والدوران
    this.msg.on('occt.extrude', this.handleExtrude.bind(this));
    this.msg.on('occt.revolve', this.handleRevolve.bind(this));
    
    // إدارة النظام
    this.msg.on('occt.release', (message) => {
      const { id } = message.data;
      this.executeOperation('release', { shapeId: id })
        .catch(error => {
          console.warn('Failed to release shape:', error);
        });
    });
    
    this.msg.on('occt.getStatus', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            initialized: this.state.initialized,
            initializing: this.state.initializing,
            workers: {
              total: this.workers.length,
              available: this.availableWorkers.length,
              busy: this.busyWorkers.size
            },
            queue: {
              length: this.taskQueue.length,
              active: this.activeTasks.size
            },
            stats: this.stats,
            lastError: this.state.lastError
          }
        });
      }
    });
    
    // إعادة تهيئة Workers
    this.msg.on('occt.reinitialize', async () => {
      await this.reinitializeWorkers();
    });
  }
  
  /**
   * تهيئة مجموعة Workers
   */
  async initializeWorkerPool() {
    if (this.state.initializing) {
      console.warn('OCCT already initializing');
      return;
    }
    
    this.state.initializing = true;
    console.log('Initializing OCCT worker pool...');
    
    try {
      // الحصول على URLs للموارد
      const [wasmUrl, jsUrl] = await Promise.all([
        this.msg.request('resources.getUrl', {
          resource: 'opencascade.wasm',
          type: 'wasm'
        }),
        this.msg.request('resources.getUrl', {
          resource: 'opencascade.js',
          type: 'javascript'
        })
      ]);
      
      console.log('Resource URLs:', { wasmUrl, jsUrl });
      
      // التحقق من URLs
      if (!wasmUrl || !jsUrl) {
        throw new Error('Failed to get resource URLs');
      }
      
      // إنشاء Workers الأولية
      const workerPromises = [];
      for (let i = 0; i < this.minWorkers; i++) {
        workerPromises.push(this.createWorker(wasmUrl, jsUrl, i));
      }
      
      const workers = await Promise.allSettled(workerPromises);
      
      // معالجة النتائج
      const successfulWorkers = [];
      const failedWorkers = [];
      
      workers.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successfulWorkers.push(result.value);
        } else {
          failedWorkers.push({ index, error: result.reason });
          this.stats.initFailures++;
        }
      });
      
      if (successfulWorkers.length === 0) {
        throw new Error('Failed to create any workers');
      }
      
      this.workers = successfulWorkers;
      this.availableWorkers = [...successfulWorkers];
      
      console.log(`OCCT initialized with ${successfulWorkers.length} workers`);
      
      if (failedWorkers.length > 0) {
        console.warn(`${failedWorkers.length} workers failed to initialize:`, failedWorkers);
      }
      
      this.state.initialized = true;
      this.state.initializing = false;
      
      this.msg.emit('occt.ready', {
        workerCount: this.workers.length,
        failures: failedWorkers.length
      });
      
    } catch (error) {
      console.error('Failed to initialize OCCT worker pool:', error);
      this.state.lastError = error.message;
      this.state.initializing = false;
      this.stats.initFailures++;
      
      this.msg.emit('occt.error', {
        type: 'initialization',
        error: error.message
      });
    }
  }
  
  /**
   * إنشاء worker جديد
   */
  async createWorker(wasmUrl, jsUrl, index = null) {
    const workerId = index !== null ? `worker-${index}` : `worker-${Date.now()}`;
    console.log(`Creating ${workerId}...`);
    
    return new Promise(async (resolve, reject) => {
      try {
        // التحقق من وجود worker file
        const workerUrl = '/workers/occt-worker.js';
        const checkResponse = await fetch(workerUrl);
        
        if (!checkResponse.ok) {
          throw new Error(`Worker file not found at ${workerUrl} (${checkResponse.status})`);
        }
        
        // تحميل worker code
        const workerCode = await checkResponse.text();
        
        // التحقق من أن المحتوى هو JavaScript
        if (workerCode.includes('<!DOCTYPE') || workerCode.includes('<html')) {
          throw new Error('Worker file returned HTML instead of JavaScript');
        }
        
        if (workerCode.length < 1000) {
          throw new Error(`Worker file too small (${workerCode.length} bytes), possibly corrupted`);
        }
        
        // إنشاء blob URL
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        
        // إنشاء worker
        const worker = new Worker(blobUrl);
        worker._id = workerId;
        worker._blobUrl = blobUrl;
        
        // timeout للتهيئة
        const initTimeout = setTimeout(() => {
          console.error(`${workerId} initialization timeout`);
          worker.terminate();
          reject(new Error(`${workerId} initialization timeout`));
        }, 60000); // 60 seconds for WASM loading
        
        let ready = false;
        
        worker.onmessage = (e) => {
          if (e.data.type === 'ready' && !ready) {
            clearTimeout(initTimeout);
            ready = true;
            console.log(`${workerId} ready`);
            resolve(worker);
          } else if (e.data.type === 'error' && !ready) {
            clearTimeout(initTimeout);
            console.error(`${workerId} init error:`, e.data.error);
            reject(new Error(e.data.error));
          } else if (e.data.type === 'log') {
            console.log(`[${workerId}]:`, e.data.result);
          }
          
          // معالجة رسائل أخرى
          if (ready) {
            this.handleWorkerMessage(worker, e);
          }
        };
        
        worker.onerror = (error) => {
          console.error(`${workerId} error:`, error);
          clearTimeout(initTimeout);
          
          if (!ready) {
            reject(new Error(`${workerId} error: ${error.message || 'Unknown error'}`));
          } else {
            this.handleWorkerCrash(worker);
          }
        };
        
        // تهيئة الـ worker
        console.log(`Initializing ${workerId}...`);
        worker.postMessage({
          type: 'init',
          wasmUrl,
          jsUrl
        });
        
      } catch (error) {
        console.error(`Failed to create ${workerId}:`, error);
        reject(new Error(`Failed to create ${workerId}: ${error.message}`));
      }
    });
  }
  
  /**
   * معالجة رسائل Worker
   */
  handleWorkerMessage(worker, event) {
    const { type, taskId, result, error } = event.data;
    
    switch (type) {
      case 'result':
        this.handleTaskComplete(taskId, result);
        break;
        
      case 'error':
        this.handleTaskError(taskId, error);
        break;
        
      case 'log':
        console.log(`[${worker._id}]:`, result);
        break;
        
      case 'warning':
        console.warn(`[${worker._id}]:`, result);
        break;
    }
  }
  
  /**
   * تنفيذ عملية في worker
   */
  async executeOperation(operation, params) {
    if (!this.state.initialized) {
      throw new Error('OCCT not initialized');
    }
    
    const taskId = `task_${++this.taskIdCounter}`;
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const task = {
        id: taskId,
        operation,
        params,
        resolve,
        reject,
        startTime,
        attempts: 0
      };
      
      this.activeTasks.set(taskId, task);
      this.taskQueue.push(task);
      this.stats.totalTasks++;
      
      this.processNextTask();
    });
  }
  
  /**
   * معالجة المهمة التالية
   */
  processNextTask() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }
    
    const task = this.taskQueue.shift();
    const worker = this.availableWorkers.shift();
    
    this.busyWorkers.set(task.id, worker);
    
    console.log(`Assigning ${task.id} (${task.operation}) to ${worker._id}`);
    
    worker.postMessage({
      type: 'execute',
      taskId: task.id,
      operation: task.operation,
      params: task.params
    });
  }
  
  /**
   * معالجة إكمال المهمة
   */
  handleTaskComplete(taskId, result) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.warn(`Task ${taskId} not found`);
      return;
    }
    
    const worker = this.busyWorkers.get(taskId);
    if (worker) {
      console.log(`${worker._id} completed ${taskId}`);
      this.busyWorkers.delete(taskId);
      this.availableWorkers.push(worker);
    }
    
    // تحديث الإحصائيات
    const duration = Date.now() - task.startTime;
    this.stats.completedTasks++;
    this.stats.averageTime = 
      (this.stats.averageTime * (this.stats.completedTasks - 1) + duration) / 
      this.stats.completedTasks;
    
    // إكمال المهمة
    task.resolve(result);
    this.activeTasks.delete(taskId);
    
    // معالجة المهمة التالية
    this.processNextTask();
  }
  
  /**
   * معالجة خطأ المهمة
   */
  handleTaskError(taskId, error) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.warn(`Task ${taskId} not found`);
      return;
    }
    
    const worker = this.busyWorkers.get(taskId);
    if (worker) {
      console.error(`${worker._id} failed ${taskId}:`, error);
      this.busyWorkers.delete(taskId);
      this.availableWorkers.push(worker);
    }
    
    // تحديث الإحصائيات
    this.stats.failedTasks++;
    
    // رفض المهمة
    task.reject(new Error(error));
    this.activeTasks.delete(taskId);
    
    // معالجة المهمة التالية
    this.processNextTask();
  }
  
  /**
   * معالجة تعطل Worker
   */
  async handleWorkerCrash(crashedWorker) {
    console.error(`Worker ${crashedWorker._id} crashed`);
    this.stats.workerCrashes++;
    
    // تنظيف blob URL
    if (crashedWorker._blobUrl) {
      URL.revokeObjectURL(crashedWorker._blobUrl);
    }
    
    // إزالة من القوائم
    const index = this.workers.indexOf(crashedWorker);
    if (index > -1) {
      this.workers.splice(index, 1);
    }
    
    const availIndex = this.availableWorkers.indexOf(crashedWorker);
    if (availIndex > -1) {
      this.availableWorkers.splice(availIndex, 1);
    }
    
    // البحث عن المهام المعلقة وإعادتها للقائمة
    const tasksToRetry = [];
    for (const [taskId, worker] of this.busyWorkers) {
      if (worker === crashedWorker) {
        const task = this.activeTasks.get(taskId);
        if (task) {
          task.attempts++;
          if (task.attempts < 3) {
            tasksToRetry.push(task);
          } else {
            task.reject(new Error('Worker crashed and max retries reached'));
            this.activeTasks.delete(taskId);
            this.stats.failedTasks++;
          }
        }
        this.busyWorkers.delete(taskId);
      }
    }
    
    // إعادة المهام للقائمة
    this.taskQueue.unshift(...tasksToRetry);
    
    // محاولة إنشاء worker بديل
    if (this.workers.length < this.minWorkers) {
      try {
        const [wasmUrl, jsUrl] = await Promise.all([
          this.msg.request('resources.getUrl', {
            resource: 'opencascade.wasm',
            type: 'wasm'
          }),
          this.msg.request('resources.getUrl', {
            resource: 'opencascade.js',
            type: 'javascript'
          })
        ]);
        
        const newWorker = await this.createWorker(wasmUrl, jsUrl);
        this.workers.push(newWorker);
        this.availableWorkers.push(newWorker);
        
        console.log(`Replacement worker created: ${newWorker._id}`);
        
        this.processNextTask();
      } catch (error) {
        console.error('Failed to create replacement worker:', error);
        this.msg.emit('occt.workerError', {
          type: 'replacement-failed',
          error: error.message
        });
      }
    }
  }
  
  /**
   * إعادة تهيئة Workers
   */
  async reinitializeWorkers() {
    console.log('Reinitializing OCCT workers...');
    
    // إيقاف جميع Workers الحالية
    await this.cleanup();
    
    // إعادة التهيئة
    this.state.initialized = false;
    this.state.lastError = null;
    await this.initializeWorkerPool();
  }
  
  // معالجات العمليات المختلفة
  
  async handleCreateBox(message) {
    try {
      const result = await this.executeOperation('createBox', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeCreated', {
        type: 'box',
        shape: result
      });
      
    } catch (error) {
      console.error('Create box failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateSphere(message) {
    try {
      const result = await this.executeOperation('createSphere', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeCreated', {
        type: 'sphere',
        shape: result
      });
      
    } catch (error) {
      console.error('Create sphere failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateCylinder(message) {
    try {
      const result = await this.executeOperation('createCylinder', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeCreated', {
        type: 'cylinder',
        shape: result
      });
      
    } catch (error) {
      console.error('Create cylinder failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateCone(message) {
    try {
      const result = await this.executeOperation('createCone', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeCreated', {
        type: 'cone',
        shape: result
      });
      
    } catch (error) {
      console.error('Create cone failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateTorus(message) {
    try {
      const result = await this.executeOperation('createTorus', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeCreated', {
        type: 'torus',
        shape: result
      });
      
    } catch (error) {
      console.error('Create torus failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleBoolean(message) {
    try {
      const result = await this.executeOperation('boolean', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeModified', {
        operation: 'boolean',
        shape: result
      });
      
    } catch (error) {
      console.error('Boolean operation failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleTransform(message) {
    try {
      const result = await this.executeOperation('transform', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeTransformed', {
        shape: result
      });
      
    } catch (error) {
      console.error('Transform failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleToMesh(message) {
    try {
      const result = await this.executeOperation('toMesh', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.meshGenerated', {
        mesh: result
      });
      
    } catch (error) {
      console.error('Mesh conversion failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleMeasure(message) {
    try {
      const result = await this.executeOperation('measure', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
    } catch (error) {
      console.error('Measure failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleFillet(message) {
    try {
      const result = await this.executeOperation('fillet', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeModified', {
        operation: 'fillet',
        shape: result
      });
      
    } catch (error) {
      console.error('Fillet failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleChamfer(message) {
    try {
      const result = await this.executeOperation('chamfer', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeModified', {
        operation: 'chamfer',
        shape: result
      });
      
    } catch (error) {
      console.error('Chamfer failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleExtrude(message) {
    try {
      const result = await this.executeOperation('extrude', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeCreated', {
        type: 'extrusion',
        shape: result
      });
      
    } catch (error) {
      console.error('Extrude failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleRevolve(message) {
    try {
      const result = await this.executeOperation('revolve', message.data);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.msg.emit('occt.shapeCreated', {
        type: 'revolution',
        shape: result
      });
      
    } catch (error) {
      console.error('Revolve failed:', error);
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  /**
   * تنظيف الموارد
   */
  async cleanup() {
    console.log('Cleaning up OCCT module...');
    
    // إيقاف معالجة المهام
    this.taskQueue = [];
    
    // رفض جميع المهام المعلقة
    for (const [taskId, task] of this.activeTasks) {
      task.reject(new Error('OCCT module shutting down'));
    }
    this.activeTasks.clear();
    
    // إيقاف جميع Workers
    const shutdownPromises = this.workers.map(worker => {
      return new Promise(resolve => {
        const shutdownTimeout = setTimeout(() => {
          worker.terminate();
          resolve();
        }, 5000);
        
        worker.onmessage = (e) => {
          if (e.data.type === 'shutdown-complete') {
            clearTimeout(shutdownTimeout);
            worker.terminate();
            resolve();
          }
        };
        
        worker.postMessage({ type: 'shutdown' });
      });
    });
    
    await Promise.all(shutdownPromises);
    
    // تنظيف blob URLs
    this.workers.forEach(worker => {
      if (worker._blobUrl) {
        URL.revokeObjectURL(worker._blobUrl);
      }
    });
    
    this.workers = [];
    this.availableWorkers = [];
    this.busyWorkers.clear();
    
    console.log('OCCT cleanup complete');
  }
  
  // دورة الحياة
  async start() {
    console.log('OCCT module started');
  }

  async stop() {
    await this.cleanup();
  }

  async healthCheck() {
    return {
      healthy: this.state.initialized && this.workers.length > 0,
      initialized: this.state.initialized,
      workersCount: this.workers.length,
      tasksQueued: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      stats: this.stats
    };
  }
}
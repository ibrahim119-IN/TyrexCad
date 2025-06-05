/**
 * Security Manager - نظام الأمان والصلاحيات
 */
export class SecurityManager {
  constructor(messageBus) {
    if (!messageBus) {
      throw new Error('MessageBus is required');
    }
    
    this.messageBus = messageBus;
    
    // تعريف الصلاحيات
    this.capabilities = {
      'core': ['*'], // كل الصلاحيات
      'plugin': ['geometry.*', 'viewport.*', 'state.*'],
      'userScript': ['geometry.create', 'geometry.query', 'viewport.getInfo']
    };
    
    // الموديولات ومستوياتها
    this.moduleTrust = new Map();
    
    this.setupHandlers();
  }
  
  setupHandlers() {
    // طلب التحقق من صلاحية
    this.messageBus.on('security.checkCapability', (message) => {
      const { moduleId, capability } = message.data;
      const allowed = this.checkCapability(moduleId, capability);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result: { allowed }
        });
      }
    });
    
    // تسجيل موديول
    this.messageBus.on('security.registerModule', (message) => {
      const { moduleId, trustLevel } = message.data;
      this.registerModule(moduleId, trustLevel);
    });
  }
  
  registerModule(moduleId, trustLevel = 'plugin') {
    this.moduleTrust.set(moduleId, trustLevel);
  }
  
  checkCapability(moduleId, capability) {
    const trustLevel = this.moduleTrust.get(moduleId) || 'userScript';
    const allowedCapabilities = this.capabilities[trustLevel] || [];
    
    // تحقق من wildcard
    return allowedCapabilities.some(cap => {
      if (cap === '*') return true;
      if (cap.endsWith('*')) {
        const prefix = cap.slice(0, -1);
        return capability.startsWith(prefix);
      }
      return cap === capability;
    });
  }
  
  cleanup() {
    this.moduleTrust.clear();
  }
}
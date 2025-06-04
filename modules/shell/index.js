/**
 * Shell Module - واجهة المستخدم المجردة
 * 
 * يوفر:
 * - تحويل أحداث DOM لرسائل
 * - تحديث UI بناءً على رسائل النظام
 * - إدارة المكونات
 * - نظام themes
 */

export default class ShellModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // مكونات UI
    this.components = new Map();
    
    // حالة UI
    this.uiState = {
      theme: 'dark',
      sidebarOpen: true,
      activeView: 'viewport',
      statusMessage: ''
    };
    
    // Event listeners للتنظيف
    this.listeners = new Map();
    
    this.setupHandlers();
    this.initializeUI();
    
    // بث رسالة الجاهزية
    this.msg.emit('shell.ready', {
      version: this.version,
      theme: this.uiState.theme
    });
  }

  setupHandlers() {
    // عرض رسالة في الحالة
    this.msg.on('shell.showStatus', (message) => {
      const { text, type = 'info', duration = 3000 } = message.data;
      this.showStatus(text, type, duration);
    });

    // تحديث العنوان
    this.msg.on('shell.setTitle', (message) => {
      const { title } = message.data;
      if (typeof document !== 'undefined') {
        document.title = title;
      }
    });

    // تبديل السايدبار
    this.msg.on('shell.toggleSidebar', () => {
      this.uiState.sidebarOpen = !this.uiState.sidebarOpen;
      this.updateSidebar();
    });

    // تغيير الثيم
    this.msg.on('shell.setTheme', (message) => {
      const { theme } = message.data;
      this.setTheme(theme);
    });

    // تسجيل مكون
    this.msg.on('shell.registerComponent', (message) => {
      const { id, element, options = {} } = message.data;
      this.registerComponent(id, element, options);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, { success: true });
      }
    });

    // تحديث مكون
    this.msg.on('shell.updateComponent', (message) => {
      const { id, updates } = message.data;
      this.updateComponent(id, updates);
    });

    // معلومات UI
    this.msg.on('shell.getInfo', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            version: this.version,
            theme: this.uiState.theme,
            components: Array.from(this.components.keys()),
            state: this.uiState
          }
        });
      }
    });
  }

  initializeUI() {
    if (typeof document === 'undefined') return;
    
    // إعداد الثيم الافتراضي
    this.setTheme(this.uiState.theme);
    
    // إعداد أحداث DOM الأساسية
    this.setupDOMListeners();
    
    // إنشاء العناصر الأساسية
    this.createBaseElements();
  }

  setupDOMListeners() {
    if (typeof document === 'undefined') return;
    
    // كشف تغيير حجم النافذة
    const resizeHandler = () => {
      this.msg.emit('shell.resized', {
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', resizeHandler);
    this.listeners.set('resize', resizeHandler);
    
    // كشف اختصارات لوحة المفاتيح
    const keyHandler = (e) => {
      // Ctrl/Cmd + S للحفظ
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.msg.emit('shell.shortcut', { action: 'save' });
      }
      // Ctrl/Cmd + Z للتراجع
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.msg.emit('shell.shortcut', { action: 'undo' });
      }
      // Ctrl/Cmd + Shift + Z للإعادة
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        this.msg.emit('shell.shortcut', { action: 'redo' });
      }
    };
    document.addEventListener('keydown', keyHandler);
    this.listeners.set('keydown', keyHandler);
  }

  createBaseElements() {
    if (typeof document === 'undefined') return;
    
    const app = document.getElementById('app');
    if (!app) return;
    
    // إنشاء الهيكل الأساسي
    app.innerHTML = `
      <div class="tyrexcad-shell">
        <header class="shell-header">
          <div class="logo">TyrexCAD</div>
          <div class="toolbar" id="main-toolbar"></div>
          <div class="status" id="status-bar"></div>
        </header>
        
        <div class="shell-body">
          <aside class="shell-sidebar ${this.uiState.sidebarOpen ? 'open' : ''}" id="sidebar">
            <div class="sidebar-content"></div>
          </aside>
          
          <main class="shell-main" id="main-content">
            <div class="viewport-container" id="viewport"></div>
          </main>
        </div>
      </div>
    `;
    
    // تطبيق الأنماط الأساسية
    this.applyBaseStyles();
  }

  applyBaseStyles() {
    if (typeof document === 'undefined') return;
    
    // إضافة أنماط CSS أساسية
    const style = document.createElement('style');
    style.textContent = `
      .tyrexcad-shell {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--bg-primary);
        color: var(--text-primary);
      }
      
      .shell-header {
        display: flex;
        align-items: center;
        height: 48px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
        padding: 0 16px;
      }
      
      .logo {
        font-weight: bold;
        margin-right: 24px;
      }
      
      .toolbar {
        flex: 1;
      }
      
      .status {
        font-size: 14px;
        opacity: 0.8;
      }
      
      .shell-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      
      .shell-sidebar {
        width: 240px;
        background: var(--bg-secondary);
        border-right: 1px solid var(--border-color);
        transition: margin-left 0.3s;
      }
      
      .shell-sidebar:not(.open) {
        margin-left: -240px;
      }
      
      .shell-main {
        flex: 1;
        overflow: hidden;
      }
      
      .viewport-container {
        width: 100%;
        height: 100%;
      }
      
      /* Dark theme */
      :root[data-theme="dark"] {
        --bg-primary: #1a1a1a;
        --bg-secondary: #242424;
        --text-primary: #ffffff;
        --text-secondary: #b0b0b0;
        --border-color: #333333;
      }
      
      /* Light theme */
      :root[data-theme="light"] {
        --bg-primary: #ffffff;
        --bg-secondary: #f5f5f5;
        --text-primary: #000000;
        --text-secondary: #666666;
        --border-color: #e0e0e0;
      }
    `;
    document.head.appendChild(style);
  }

  registerComponent(id, element, options) {
    if (this.components.has(id)) {
      console.warn(`Component ${id} already registered`);
      return;
    }
    
    this.components.set(id, {
      element,
      options,
      mounted: false
    });
    
    // تركيب المكون إذا كان له container
    if (options.container) {
      this.mountComponent(id, options.container);
    }
  }

  mountComponent(id, containerId) {
    const component = this.components.get(id);
    if (!component || typeof document === 'undefined') return;
    
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`Container ${containerId} not found`);
      return;
    }
    
    if (typeof component.element === 'string') {
      container.innerHTML = component.element;
    } else if (component.element instanceof Element) {
      container.appendChild(component.element);
    }
    
    component.mounted = true;
  }

  updateComponent(id, updates) {
    const component = this.components.get(id);
    if (!component || !component.mounted) return;
    
    // تطبيق التحديثات
    if (updates.content && typeof document !== 'undefined') {
      const container = document.querySelector(`[data-component="${id}"]`);
      if (container) {
        container.innerHTML = updates.content;
      }
    }
  }

  showStatus(text, type = 'info', duration = 3000) {
    if (typeof document === 'undefined') return;
    
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return;
    
    statusBar.textContent = text;
    statusBar.className = `status status-${type}`;
    
    // مسح الرسالة بعد المدة المحددة
    if (duration > 0) {
      setTimeout(() => {
        if (statusBar.textContent === text) {
          statusBar.textContent = '';
        }
      }, duration);
    }
    
    this.uiState.statusMessage = text;
  }

  setTheme(theme) {
    if (typeof document === 'undefined') return;
    
    document.documentElement.setAttribute('data-theme', theme);
    this.uiState.theme = theme;
    
    // حفظ الثيم
    this.msg.emit('storage.set', {
      key: 'shell.theme',
      value: theme
    });
    
    // بث تغيير الثيم
    this.msg.emit('shell.themeChanged', { theme });
  }

  updateSidebar() {
    if (typeof document === 'undefined') return;
    
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    
    if (this.uiState.sidebarOpen) {
      sidebar.classList.add('open');
    } else {
      sidebar.classList.remove('open');
    }
    
    // بث حدث تغيير السايدبار
    this.msg.emit('shell.sidebarToggled', {
      open: this.uiState.sidebarOpen
    });
  }

  // دورة الحياة
  async start() {
    console.log('Shell module started');
    
    // استرجاع الثيم المحفوظ
    try {
      const savedTheme = await this.msg.request('storage.get', {
        key: 'shell.theme'
      });
      if (savedTheme) {
        this.setTheme(savedTheme);
      }
    } catch (error) {
      // استخدم الثيم الافتراضي
    }
  }

  async stop() {
    // تنظيف المستمعين
    this.listeners.forEach((handler, event) => {
      if (event === 'resize') {
        window.removeEventListener(event, handler);
      } else {
        document.removeEventListener(event, handler);
      }
    });
    this.listeners.clear();
  }

  async healthCheck() {
    return true;
  }

  async cleanup() {
    this.components.clear();
    this.listeners.clear();
    this.msg.off('shell.*');
  }
}
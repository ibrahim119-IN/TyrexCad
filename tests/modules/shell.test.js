/**
 * اختبارات Shell Module
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import ShellModule from '../../modules/shell/index.js';

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
    trigger: async (event, data, requestId = null) => {
      const eventHandlers = handlers.get(event) || [];
      for (const handler of eventHandlers) {
        await handler({ event, data, requestId });
      }
    }
  };
}

// Mock DOM
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe('ShellModule', () => {
  let shell;
  let mockAPI;

  beforeEach(() => {
    mockAPI = createMockMessageAPI();
    shell = new ShellModule(mockAPI);
  });

  afterEach(async () => {
    await shell.cleanup();
    document.body.innerHTML = '';
  });

  describe('Basic Operations', () => {
    test('should initialize correctly', () => {
      expect(shell.version).toBe('1.0.0');
      expect(shell.components).toBeInstanceOf(Map);
      expect(shell.uiState.theme).toBe('dark');
      
      expect(mockAPI.emit).toHaveBeenCalledWith('shell.ready', {
        version: '1.0.0',
        theme: 'dark'
      });
    });

    test('should create base UI structure', () => {
      const shellElement = document.querySelector('.tyrexcad-shell');
      expect(shellElement).toBeTruthy();
      
      const header = document.querySelector('.shell-header');
      expect(header).toBeTruthy();
      
      const sidebar = document.querySelector('.shell-sidebar');
      expect(sidebar).toBeTruthy();
      expect(sidebar.classList.contains('open')).toBe(true);
      
      const main = document.querySelector('.shell-main');
      expect(main).toBeTruthy();
    });

    test('should handle shell.showStatus', async () => {
      await mockAPI.trigger('shell.showStatus', {
        text: 'Test message',
        type: 'success',
        duration: 100
      });

      const statusBar = document.getElementById('status-bar');
      expect(statusBar.textContent).toBe('Test message');
      expect(statusBar.className).toContain('status-success');
      
      // انتظار انتهاء المدة
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(statusBar.textContent).toBe('');
    });

    test('should handle shell.setTitle', async () => {
      await mockAPI.trigger('shell.setTitle', {
        title: 'New Title - TyrexCAD'
      });

      expect(document.title).toBe('New Title - TyrexCAD');
    });

    test('should handle shell.toggleSidebar', async () => {
      const sidebar = document.getElementById('sidebar');
      expect(sidebar.classList.contains('open')).toBe(true);

      await mockAPI.trigger('shell.toggleSidebar', {});
      expect(sidebar.classList.contains('open')).toBe(false);
      expect(shell.uiState.sidebarOpen).toBe(false);

      await mockAPI.trigger('shell.toggleSidebar', {});
      expect(sidebar.classList.contains('open')).toBe(true);
      expect(shell.uiState.sidebarOpen).toBe(true);
    });
  });

  describe('Theme Management', () => {
    test('should handle shell.setTheme', async () => {
      await mockAPI.trigger('shell.setTheme', {
        theme: 'light'
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(shell.uiState.theme).toBe('light');
      
      expect(mockAPI.emit).toHaveBeenCalledWith('storage.set', {
        key: 'shell.theme',
        value: 'light'
      });
      
      expect(mockAPI.emit).toHaveBeenCalledWith('shell.themeChanged', {
        theme: 'light'
      });
    });

    test('should load saved theme on start', async () => {
      mockAPI.request.mockResolvedValueOnce('light');
      
      await shell.start();
      
      expect(mockAPI.request).toHaveBeenCalledWith('storage.get', {
        key: 'shell.theme'
      });
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  describe('Component Management', () => {
    test('should register component', async () => {
      await mockAPI.trigger('shell.registerComponent', {
        id: 'test-component',
        element: '<div>Test Component</div>',
        options: {}
      }, 'req-1');

      expect(shell.components.has('test-component')).toBe(true);
      expect(mockAPI.reply).toHaveBeenCalledWith('req-1', {
        success: true
      });
    });

    test('should mount component to container', () => {
      // إضافة container
      document.getElementById('app').innerHTML += '<div id="test-container"></div>';
      
      shell.registerComponent('test-comp', '<p>Hello</p>', {
        container: 'test-container'
      });
      
      const container = document.getElementById('test-container');
      expect(container.innerHTML).toBe('<p>Hello</p>');
    });

    test('should update component', async () => {
      document.getElementById('app').innerHTML += '<div data-component="test"></div>';
      
      shell.components.set('test', {
        mounted: true
      });
      
      await mockAPI.trigger('shell.updateComponent', {
        id: 'test',
        updates: { content: '<span>Updated</span>' }
      });
      
      const component = document.querySelector('[data-component="test"]');
      expect(component.innerHTML).toBe('<span>Updated</span>');
    });
  });

  describe('Keyboard Shortcuts', () => {
    test('should handle Ctrl+S for save', () => {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true
      });
      
      document.dispatchEvent(event);
      
      expect(mockAPI.emit).toHaveBeenCalledWith('shell.shortcut', {
        action: 'save'
      });
    });

    test('should handle Ctrl+Z for undo', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true
      });
      
      document.dispatchEvent(event);
      
      expect(mockAPI.emit).toHaveBeenCalledWith('shell.shortcut', {
        action: 'undo'
      });
    });

    test('should handle Ctrl+Shift+Z for redo', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true
      });
      
      document.dispatchEvent(event);
      
      expect(mockAPI.emit).toHaveBeenCalledWith('shell.shortcut', {
        action: 'redo'
      });
    });
  });

  describe('Window Events', () => {
    test('should emit resize event', () => {
      // تغيير حجم النافذة
      window.dispatchEvent(new Event('resize'));
      
      expect(mockAPI.emit).toHaveBeenCalledWith('shell.resized', {
        width: window.innerWidth,
        height: window.innerHeight
      });
    });
  });

  describe('Info Request', () => {
    test('should provide shell info', async () => {
      await mockAPI.trigger('shell.getInfo', {}, 'req-2');
      
      expect(mockAPI.reply).toHaveBeenCalledWith('req-2', {
        success: true,
        result: expect.objectContaining({
          version: '1.0.0',
          theme: 'dark',
          components: expect.any(Array),
          state: expect.objectContaining({
            theme: 'dark',
            sidebarOpen: true
          })
        })
      });
    });
  });

  describe('Lifecycle', () => {
    test('should cleanup properly', async () => {
      // إضافة مستمعين
      shell.listeners.set('test', () => {});
      shell.components.set('test', {});
      
      await shell.cleanup();
      
      expect(shell.components.size).toBe(0);
      expect(shell.listeners.size).toBe(0);
      expect(mockAPI.off).toHaveBeenCalledWith('shell.*');
    });
  });

  describe('Health Check', () => {
    test('should always pass health check', async () => {
      const healthy = await shell.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
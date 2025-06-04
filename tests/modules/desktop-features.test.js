/**
 * اختبارات Desktop Features Module
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import DesktopFeaturesModule from '../../modules/desktop-features/index.js';

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

describe('DesktopFeaturesModule', () => {
  let desktop;
  let mockAPI;

  beforeEach(() => {
    mockAPI = createMockMessageAPI();
    desktop = new DesktopFeaturesModule(mockAPI);
  });

  afterEach(async () => {
    await desktop.cleanup();
    delete window.electronAPI;
  });

  describe('Basic Operations', () => {
    test('should initialize correctly', () => {
      expect(desktop.version).toBe('1.0.0');
      expect(desktop.isElectron).toBe(false);
      
      expect(mockAPI.emit).toHaveBeenCalledWith('desktop.ready', {
        version: '1.0.0',
        available: false
      });
    });

    test('should detect Electron environment', () => {
      window.electronAPI = {};
      const desktopElectron = new DesktopFeaturesModule(mockAPI);
      
      expect(desktopElectron.isElectron).toBe(true);
    });
  });

  describe('Browser Environment', () => {
    test('should reply not available for openFile', async () => {
      await mockAPI.trigger('desktop.openFile', {}, 'req-1');
      
      expect(mockAPI.reply).toHaveBeenCalledWith('req-1', {
        success: false,
        error: 'Desktop features not available in browser'
      });
    });

    test('should reply not available for saveFile', async () => {
      await mockAPI.trigger('desktop.saveFile', {
        data: 'test data'
      }, 'req-2');
      
      expect(mockAPI.reply).toHaveBeenCalledWith('req-2', {
        success: false,
        error: 'Desktop features not available in browser'
      });
    });

    test('should reply not available for getSystemInfo', async () => {
      await mockAPI.trigger('desktop.getSystemInfo', {}, 'req-3');
      
      expect(mockAPI.reply).toHaveBeenCalledWith('req-3', {
        success: false,
        error: 'Desktop features not available in browser'
      });
    });
  });

  describe('Electron Environment', () => {
    beforeEach(() => {
      window.electronAPI = {
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        getSystemInfo: vi.fn(),
        toggleFullscreen: vi.fn(),
        getRecentFiles: vi.fn(),
        addToRecentFiles: vi.fn(),
        updateMenu: vi.fn()
      };
      
      // إعادة إنشاء الموديول مع Electron API
      desktop = new DesktopFeaturesModule(mockAPI);
    });

    test('should handle openFile successfully', async () => {
      window.electronAPI.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/file.step']
      });
      window.electronAPI.readFile.mockResolvedValue('file content');

      await mockAPI.trigger('desktop.openFile', {
        filters: [{ name: 'STEP Files', extensions: ['step'] }]
      }, 'req-4');

      expect(window.electronAPI.showOpenDialog).toHaveBeenCalledWith({
        filters: [{ name: 'STEP Files', extensions: ['step'] }],
        properties: ['openFile']
      });

      expect(mockAPI.reply).toHaveBeenCalledWith('req-4', {
        success: true,
        result: {
          path: '/path/to/file.step',
          data: 'file content',
          name: 'file.step'
        }
      });

      expect(desktop.stats.filesOpened).toBe(1);
    });

    test('should handle openFile cancellation', async () => {
      window.electronAPI.showOpenDialog.mockResolvedValue({
        canceled: true
      });

      await mockAPI.trigger('desktop.openFile', {}, 'req-5');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-5', {
        success: false,
        error: 'User canceled'
      });
    });

    test('should handle saveFile successfully', async () => {
      window.electronAPI.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: '/path/to/saved.stl'
      });

      await mockAPI.trigger('desktop.saveFile', {
        data: 'file data',
        defaultPath: 'model.stl'
      }, 'req-6');

      expect(window.electronAPI.writeFile).toHaveBeenCalledWith(
        '/path/to/saved.stl',
        'file data'
      );

      expect(mockAPI.reply).toHaveBeenCalledWith('req-6', {
        success: true,
        result: {
          path: '/path/to/saved.stl',
          name: 'saved.stl'
        }
      });

      expect(desktop.stats.filesSaved).toBe(1);
    });

    test('should handle getSystemInfo', async () => {
      const mockInfo = {
        platform: 'win32',
        version: '10.0.0',
        memory: 16384
      };
      window.electronAPI.getSystemInfo.mockResolvedValue(mockInfo);

      await mockAPI.trigger('desktop.getSystemInfo', {}, 'req-7');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-7', {
        success: true,
        result: mockInfo
      });
    });

    test('should handle toggleFullscreen', async () => {
      await mockAPI.trigger('desktop.toggleFullscreen', {}, 'req-8');

      expect(window.electronAPI.toggleFullscreen).toHaveBeenCalled();
      expect(mockAPI.reply).toHaveBeenCalledWith('req-8', {
        success: true
      });
    });

    test('should handle getRecentFiles', async () => {
      const recentFiles = [
        { path: '/path/1.step', name: '1.step' },
        { path: '/path/2.iges', name: '2.iges' }
      ];
      window.electronAPI.getRecentFiles.mockResolvedValue(recentFiles);

      await mockAPI.trigger('desktop.getRecentFiles', {}, 'req-9');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-9', {
        success: true,
        result: recentFiles
      });
    });

    test('should handle errors', async () => {
      window.electronAPI.readFile.mockRejectedValue(new Error('Read failed'));
      window.electronAPI.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/file.step']
      });

      await mockAPI.trigger('desktop.openFile', {}, 'req-10');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-10', {
        success: false,
        error: 'Read failed'
      });

      expect(mockAPI.emit).toHaveBeenCalledWith('desktop.error', {
        error: 'Read failed'
      });
    });
  });

  describe('Info Request', () => {
    test('should provide desktop info', async () => {
      await mockAPI.trigger('desktop.info', {}, 'req-11');

      expect(mockAPI.reply).toHaveBeenCalledWith('req-11', {
        success: true,
        result: {
          version: '1.0.0',
          available: false,
          stats: {
            filesOpened: 0,
            filesSaved: 0,
            operations: 0
          }
        }
      });
    });
  });

  describe('Lifecycle', () => {
    test('should start and register shortcuts in Electron', async () => {
      window.electronAPI = {};
      const desktopElectron = new DesktopFeaturesModule(mockAPI);
      
      await desktopElectron.start();

      // اختبار معالج الاختصارات
      await mockAPI.trigger('shell.shortcut', {
        action: 'save'
      });

      expect(mockAPI.emit).toHaveBeenCalledWith('app.save');
    });
  });
});
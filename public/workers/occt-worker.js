// استيراد مباشر بدلاً من importScripts
import opencascadeWasm from '/wasm/opencascade.full.js';

let occt = null;
let isReady = false;

self.onmessage = async function(e) {
  const { type, data } = e.data;
  
  console.log('[Worker] Received:', type);
  
  if (type === 'init') {
    try {
      console.log('[Worker] Loading OpenCASCADE...');
      
      // تهيئة OpenCASCADE
      occt = await opencascadeWasm({
        locateFile: (file) => {
          if (file.endsWith('.wasm')) {
            return '/wasm/opencascade.full.wasm';
          }
          return file;
        }
      });
      
      isReady = true;
      self.postMessage({ type: 'ready' });
      console.log('[Worker] OpenCASCADE ready!');
      
    } catch (error) {
      console.error('[Worker] Error:', error);
      self.postMessage({ 
        type: 'error', 
        error: error.message 
      });
    }
  }
  
  if (type === 'test' && isReady) {
    try {
      const point = new occt.gp_Pnt(10, 20, 30);
      const x = point.X();
      const y = point.Y();
      const z = point.Z();
      point.delete();
      
      self.postMessage({ 
        type: 'test-result',
        result: `Point created at (${x}, ${y}, ${z})`
      });
    } catch (error) {
      self.postMessage({ 
        type: 'error', 
        error: error.message 
      });
    }
  }
};
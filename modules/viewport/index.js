/**
 * Viewport Module - عرض ثلاثي الأبعاد باستخدام Three.js
 * 
 * مسؤول عن:
 * - عرض الأشكال الهندسية
 * - التحكم بالكاميرا
 * - الإضاءة والمواد
 * - اختيار الكائنات
 */

import * as THREE from 'three';

export default class ViewportModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // Three.js objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    
    // الأشكال المعروضة
    this.objects = new Map(); // shapeId -> THREE.Mesh
    this.selectedObject = null;
    
    // إعدادات
    this.config = {
      backgroundColor: 0x1a1a1a,
      gridSize: 1000,
      gridDivisions: 50,
      ambientLightIntensity: 0.4,
      directionalLightIntensity: 0.8,
      defaultMaterial: {
        color: 0x2194ce,
        metalness: 0.5,
        roughness: 0.5
      },
      selectedMaterial: {
        color: 0xff9800,
        metalness: 0.5,
        roughness: 0.5
      }
    };
    
    // Container element
    this.container = null;
    
    // الحالة
    this.state = {
      initialized: false,
      rendering: true,
      stats: {
        fps: 0,
        meshes: 0,
        vertices: 0,
        triangles: 0
      }
    };
    
    // Animation
    this.animationId = null;
    this.lastTime = 0;
    this.frameCount = 0;
    this.fpsUpdateTime = 0;
    
    // Control state
    this.controlState = {
      isInteracting: false,
      startX: 0,
      startY: 0,
      touchStartDistance: 0,
      initialCameraDistance: 0
    };
    
    // مراجع معالجات الأحداث للتنظيف
    this.controlHandlers = null;
    this.windowListeners = new Map();
    this.domListeners = new Map();
    
    this.setupHandlers();
  }

  setupHandlers() {
    // تهيئة viewport
    this.msg.on('viewport.init', async (message) => {
      const { containerId } = message.data;
      
      try {
        await this.initialize(containerId);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { initialized: true }
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // إضافة mesh
    this.msg.on('viewport.addMesh', (message) => {
      const { shapeId, mesh, material } = message.data;
      
      try {
        this.addMesh(shapeId, mesh, material);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // إزالة mesh
    this.msg.on('viewport.removeMesh', (message) => {
      const { shapeId } = message.data;
      
      this.removeMesh(shapeId);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true
        });
      }
    });

    // مسح الكل
    this.msg.on('viewport.clear', () => {
      this.clearScene();
      this.msg.emit('viewport.cleared');
    });

    // ضبط الكاميرا
    this.msg.on('viewport.setCamera', (message) => {
      const { position, target, fov } = message.data;
      this.setCamera(position, target, fov);
    });

    // تكبير لرؤية الكل
    this.msg.on('viewport.fitAll', () => {
      this.fitAll();
    });

    // اختيار كائن
    this.msg.on('viewport.select', (message) => {
      const { shapeId } = message.data;
      this.selectObject(shapeId);
    });

    // معلومات
    this.msg.on('viewport.getInfo', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            initialized: this.state.initialized,
            stats: this.state.stats,
            objects: Array.from(this.objects.keys()),
            camera: this.camera ? {
              position: this.camera.position.toArray(),
              fov: this.camera.fov
            } : null
          }
        });
      }
    });

    // طلب تحويل shape لـ mesh
    this.msg.on('geometry-test.shapeCreated', async (message) => {
      const { id, type } = message.data;
      
      // طلب تحويل الشكل لـ mesh
      try {
        const shapeData = await this.msg.request('geometry-test.listShapes');
        const shape = shapeData.result.shapes.find(s => s.id === id);
        
        if (shape) {
          const meshResult = await this.msg.request('geometry-test.toMesh', {
            shapeId: id,
            quality: 0.1
          });
          
          if (meshResult.success) {
            this.addMesh(id, meshResult.result.mesh);
            
            // تحديث عدد الأشكال في UI
            this.msg.emit('viewport.meshAdded', {
              shapeId: id,
              stats: meshResult.result.mesh.stats
            });
          }
        }
      } catch (error) {
        console.error('Failed to convert shape to mesh:', error);
      }
    });
  }

  async initialize(containerId) {
    if (this.state.initialized) {
      console.warn('Viewport already initialized');
      return;
    }
    
    // الحصول على container
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container element "${containerId}" not found`);
    }
    
    // إنشاء Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.config.backgroundColor);
    
    // إنشاء Camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
    this.camera.position.set(200, 200, 200);
    this.camera.lookAt(0, 0, 0);
    
    // إنشاء Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    this.container.appendChild(this.renderer.domElement);
    
    // إضافة Controls بسيط
    this.setupControls();
    
    // إضافة الإضاءة
    this.setupLights();
    
    // إضافة Grid
    this.addGrid();
    
    // إضافة Axes helper
    this.addAxes();
    
    // معالج تغيير الحجم
    this.handleResize = this.onResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.windowListeners.set('resize', this.handleResize);
    
    // معالج النقر
    this.handleClick = this.onClick.bind(this);
    this.renderer.domElement.addEventListener('click', this.handleClick);
    this.domListeners.set('click', this.handleClick);
    
    // معالج WebGL context lost
    this.handleContextLost = (e) => {
      e.preventDefault();
      this.state.rendering = false;
      console.warn('WebGL context lost');
      this.msg.emit('viewport.error', { 
        type: 'contextLost',
        message: 'WebGL context lost. Waiting for restoration...'
      });
    };
    
    this.handleContextRestored = () => {
      console.log('WebGL context restored');
      this.state.rendering = true;
      
      // إعادة إنشاء المواد للـ meshes الموجودة
      for (const [shapeId, mesh] of this.objects) {
        if (mesh.material) {
          const oldMaterial = mesh.material;
          mesh.material = new THREE.MeshStandardMaterial({
            color: oldMaterial.color,
            metalness: oldMaterial.metalness,
            roughness: oldMaterial.roughness,
            side: THREE.DoubleSide
          });
          oldMaterial.dispose();
        }
      }
      
      this.animate();
      this.msg.emit('viewport.restored', {
        message: 'WebGL context restored successfully'
      });
    };
    
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.domListeners.set('webglcontextlost', this.handleContextLost);
    this.domListeners.set('webglcontextrestored', this.handleContextRestored);
    
    // بدء الرسم
    this.state.initialized = true;
    this.animate();
    
    // بث رسالة الجاهزية
    this.msg.emit('viewport.ready', {
      container: containerId,
      size: {
        width: this.container.clientWidth,
        height: this.container.clientHeight
      }
    });
  }

  setupControls() {
    const domElement = this.renderer.domElement;
    
    // معالجات الأحداث
    this.handleMouseDown = (e) => {
      this.controlState.isInteracting = true;
      this.controlState.startX = e.clientX;
      this.controlState.startY = e.clientY;
    };
    
    this.handleMouseMove = (e) => {
      if (!this.controlState.isInteracting) return;
      
      const deltaX = e.clientX - this.controlState.startX;
      const deltaY = e.clientY - this.controlState.startY;
      
      this.rotateCamera(deltaX, deltaY);
      
      this.controlState.startX = e.clientX;
      this.controlState.startY = e.clientY;
    };
    
    this.handleMouseUp = () => {
      this.controlState.isInteracting = false;
    };
    
    this.handleMouseLeave = () => {
      this.controlState.isInteracting = false;
    };
    
    this.handleWheel = (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      this.zoomCamera(scale);
    };
    
    this.handleTouchStart = (e) => {
      e.preventDefault();
      
      if (e.touches.length === 1) {
        this.controlState.isInteracting = true;
        this.controlState.startX = e.touches[0].clientX;
        this.controlState.startY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.controlState.touchStartDistance = Math.sqrt(dx * dx + dy * dy);
        this.controlState.initialCameraDistance = this.camera.position.length();
      }
    };
    
    this.handleTouchMove = (e) => {
      e.preventDefault();
      
      if (e.touches.length === 1 && this.controlState.isInteracting) {
        const deltaX = e.touches[0].clientX - this.controlState.startX;
        const deltaY = e.touches[0].clientY - this.controlState.startY;
        
        this.rotateCamera(deltaX, deltaY);
        
        this.controlState.startX = e.touches[0].clientX;
        this.controlState.startY = e.touches[0].clientY;
      } else if (e.touches.length === 2 && this.controlState.touchStartDistance > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const scale = this.controlState.touchStartDistance / distance;
        const newDistance = this.controlState.initialCameraDistance * scale;
        
        this.camera.position.normalize().multiplyScalar(newDistance);
        this.camera.lookAt(0, 0, 0);
      }
    };
    
    this.handleTouchEnd = (e) => {
      if (e.touches.length === 0) {
        this.controlState.isInteracting = false;
        this.controlState.touchStartDistance = 0;
      } else if (e.touches.length === 1) {
        this.controlState.isInteracting = true;
        this.controlState.startX = e.touches[0].clientX;
        this.controlState.startY = e.touches[0].clientY;
      }
    };
    
    this.handleTouchCancel = () => {
      this.controlState.isInteracting = false;
      this.controlState.touchStartDistance = 0;
    };
    
    // حفظ المراجع للتنظيف لاحقاً
    this.controlHandlers = {
      mousedown: this.handleMouseDown,
      mousemove: this.handleMouseMove,
      mouseup: this.handleMouseUp,
      mouseleave: this.handleMouseLeave,
      wheel: this.handleWheel,
      touchstart: this.handleTouchStart,
      touchmove: this.handleTouchMove,
      touchend: this.handleTouchEnd,
      touchcancel: this.handleTouchCancel
    };
    
    // إضافة المستمعين
    Object.entries(this.controlHandlers).forEach(([event, handler]) => {
      domElement.addEventListener(event, handler);
    });
    
    // منع السلوك الافتراضي للمس
    domElement.style.touchAction = 'none';
  }
  
  rotateCamera(deltaX, deltaY) {
    // دوران حول المحور Y
    const spherical = new THREE.Spherical();
    spherical.setFromVector3(this.camera.position);
    spherical.theta -= deltaX * 0.01;
    spherical.phi += deltaY * 0.01;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
    
    this.camera.position.setFromSpherical(spherical);
    this.camera.lookAt(0, 0, 0);
  }
  
  zoomCamera(scale) {
    this.camera.position.multiplyScalar(scale);
    this.camera.lookAt(0, 0, 0);
  }

  setupLights() {
    // إضاءة محيطة
    const ambient = new THREE.AmbientLight(0xffffff, this.config.ambientLightIntensity);
    this.scene.add(ambient);
    
    // إضاءة اتجاهية رئيسية
    const directional1 = new THREE.DirectionalLight(0xffffff, this.config.directionalLightIntensity);
    directional1.position.set(1, 1, 1);
    directional1.castShadow = true;
    directional1.shadow.mapSize.width = 2048;
    directional1.shadow.mapSize.height = 2048;
    directional1.shadow.camera.near = 0.5;
    directional1.shadow.camera.far = 500;
    directional1.shadow.camera.left = -100;
    directional1.shadow.camera.right = 100;
    directional1.shadow.camera.top = 100;
    directional1.shadow.camera.bottom = -100;
    this.scene.add(directional1);
    
    // إضاءة اتجاهية ثانوية
    const directional2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directional2.position.set(-1, 0.5, -1);
    this.scene.add(directional2);
  }

  addGrid() {
    const gridHelper = new THREE.GridHelper(
      this.config.gridSize, 
      this.config.gridDivisions,
      0x444444,
      0x222222
    );
    this.scene.add(gridHelper);
  }

  addAxes() {
    const axesHelper = new THREE.AxesHelper(100);
    this.scene.add(axesHelper);
  }

  addMesh(shapeId, meshData, materialConfig) {
    // إزالة الـ mesh القديم إذا كان موجوداً (مع تنظيف كامل)
    if (this.objects.has(shapeId)) {
      this.removeMesh(shapeId);
    }
    
    // إنشاء geometry من البيانات
    const geometry = new THREE.BufferGeometry();
    
    // إضافة vertices
    geometry.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
    
    // إضافة normals
    if (meshData.normals && meshData.normals.length > 0) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    
    // إضافة indices
    if (meshData.indices && meshData.indices.length > 0) {
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    }
    
    // حساب bounding box
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    
    // إنشاء material
    const material = new THREE.MeshStandardMaterial({
      color: materialConfig?.color || this.config.defaultMaterial.color,
      metalness: materialConfig?.metalness || this.config.defaultMaterial.metalness,
      roughness: materialConfig?.roughness || this.config.defaultMaterial.roughness,
      side: THREE.DoubleSide
    });
    
    // إنشاء mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.shapeId = shapeId;
    
    // إضافة للمشهد
    this.scene.add(mesh);
    this.objects.set(shapeId, mesh);
    
    // تحديث الإحصائيات
    this.updateStats();
    
    // بث رسالة
    this.msg.emit('viewport.meshAdded', {
      shapeId,
      vertices: meshData.stats?.vertexCount || (meshData.vertices.length / 3),
      triangles: meshData.stats?.triangleCount || (meshData.indices ? meshData.indices.length / 3 : meshData.vertices.length / 9)
    });
  }

  removeMesh(shapeId) {
    const mesh = this.objects.get(shapeId);
    if (!mesh) return;
    
    // إزالة من المشهد
    this.scene.remove(mesh);
    
    // تنظيف شامل
    if (mesh.geometry) {
      // تنظيف جميع attributes
      const geometry = mesh.geometry;
      if (geometry.attributes) {
        Object.values(geometry.attributes).forEach(attribute => {
          if (attribute.array) {
            attribute.array = null;
          }
        });
      }
      
      // تنظيف index
      if (geometry.index) {
        geometry.index.array = null;
      }
      
      geometry.dispose();
    }
    
    if (mesh.material) {
      // تنظيف textures إذا وُجدت
      if (mesh.material.map) mesh.material.map.dispose();
      if (mesh.material.normalMap) mesh.material.normalMap.dispose();
      if (mesh.material.roughnessMap) mesh.material.roughnessMap.dispose();
      if (mesh.material.metalnessMap) mesh.material.metalnessMap.dispose();
      
      mesh.material.dispose();
    }
    
    // إزالة المراجع
    mesh.geometry = null;
    mesh.material = null;
    
    // إزالة من القائمة
    this.objects.delete(shapeId);
    
    // إلغاء التحديد إذا كان محدداً
    if (this.selectedObject === mesh) {
      this.selectedObject = null;
    }
    
    // تحديث الإحصائيات
    this.updateStats();
    
    // بث رسالة
    this.msg.emit('viewport.meshRemoved', { shapeId });
  }

  clearScene() {
    // إزالة جميع الأشكال بشكل صحيح
    const shapeIds = Array.from(this.objects.keys());
    shapeIds.forEach(shapeId => {
      this.removeMesh(shapeId);
    });
    
    this.objects.clear();
    this.selectedObject = null;
    
    // تحديث الإحصائيات
    this.updateStats();
  }

  setCamera(position, target, fov) {
    if (position) {
      this.camera.position.set(position[0], position[1], position[2]);
    }
    
    if (target) {
      this.camera.lookAt(target[0], target[1], target[2]);
    }
    
    if (fov && this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  fitAll() {
    if (this.objects.size === 0) return;
    
    // حساب bounding box لجميع الأشكال
    const box = new THREE.Box3();
    
    for (const mesh of this.objects.values()) {
      box.expandByObject(mesh);
    }
    
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // ضبط الكاميرا
    const distance = maxDim * 2.5;
    this.camera.position.set(
      center.x + distance * 0.5,
      center.y + distance * 0.5,
      center.z + distance * 0.5
    );
    this.camera.lookAt(center);
    
    // بث رسالة
    this.msg.emit('viewport.cameraChanged', {
      position: this.camera.position.toArray(),
      target: center.toArray()
    });
  }

  selectObject(shapeId) {
    // إلغاء التحديد السابق
    if (this.selectedObject) {
      const prevMaterial = this.config.defaultMaterial;
      this.selectedObject.material.color.setHex(prevMaterial.color);
    }
    
    // تحديد الجديد
    const mesh = this.objects.get(shapeId);
    if (mesh) {
      mesh.material.color.setHex(this.config.selectedMaterial.color);
      this.selectedObject = mesh;
      
      // بث رسالة
      this.msg.emit('viewport.selectionChanged', { shapeId });
    } else {
      this.selectedObject = null;
      this.msg.emit('viewport.selectionChanged', { shapeId: null });
    }
  }

  onClick(event) {
    if (!this.container) return;
    
    // حساب موقع الماوس
    const rect = this.container.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Raycasting
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    
    const meshes = Array.from(this.objects.values());
    const intersects = raycaster.intersectObjects(meshes);
    
    if (intersects.length > 0) {
      const object = intersects[0].object;
      const shapeId = object.userData.shapeId;
      
      this.selectObject(shapeId);
      
      // بث رسالة نقر
      this.msg.emit('viewport.clicked', {
        shapeId,
        point: intersects[0].point.toArray(),
        distance: intersects[0].distance
      });
    } else {
      // إلغاء التحديد
      this.selectObject(null);
    }
  }

  onResize() {
    if (!this.container || !this.camera || !this.renderer) return;
    
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(width, height);
    
    // بث رسالة
    this.msg.emit('viewport.resized', { width, height });
  }

  updateStats() {
    let totalVertices = 0;
    let totalTriangles = 0;
    
    for (const mesh of this.objects.values()) {
      const geometry = mesh.geometry;
      totalVertices += geometry.attributes.position.count;
      totalTriangles += geometry.index ? geometry.index.count / 3 : 
                       geometry.attributes.position.count / 3;
    }
    
    this.state.stats.meshes = this.objects.size;
    this.state.stats.vertices = totalVertices;
    this.state.stats.triangles = Math.floor(totalTriangles);
    
    // بث الإحصائيات
    this.msg.emit('viewport.stats', this.state.stats);
  }

  animate() {
    if (!this.state.rendering) return;
    
    this.animationId = requestAnimationFrame(() => this.animate());
    
    // حساب FPS
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    
    this.frameCount++;
    if (currentTime - this.fpsUpdateTime > 1000) {
      this.state.stats.fps = Math.round(this.frameCount * 1000 / (currentTime - this.fpsUpdateTime));
      this.frameCount = 0;
      this.fpsUpdateTime = currentTime;
      
      // بث إحصائيات FPS
      this.msg.emit('viewport.stats', this.state.stats);
    }
    
    // رسم المشهد
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // دورة الحياة
  async start() {
    console.log('Viewport module started');
    this.state.rendering = true;
    
    if (this.state.initialized) {
      this.animate();
    }
  }

  async stop() {
    console.log('Viewport module stopping');
    this.state.rendering = false;
    
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  async healthCheck() {
    return {
      healthy: this.state.initialized && this.state.rendering,
      initialized: this.state.initialized,
      rendering: this.state.rendering,
      objectsCount: this.objects.size
    };
  }

  async cleanup() {
    console.log('Viewport cleanup starting...');
    
    // إيقاف الرسم
    this.state.rendering = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    // تنظيف controls
    if (this.renderer?.domElement && this.controlHandlers) {
      Object.entries(this.controlHandlers).forEach(([event, handler]) => {
        this.renderer.domElement.removeEventListener(event, handler);
      });
      this.controlHandlers = null;
    }
    
    // تنظيف window listeners
    this.windowListeners.forEach((handler, event) => {
      window.removeEventListener(event, handler);
    });
    this.windowListeners.clear();
    
    // تنظيف DOM listeners
    if (this.renderer?.domElement) {
      this.domListeners.forEach((handler, event) => {
        this.renderer.domElement.removeEventListener(event, handler);
      });
    }
    this.domListeners.clear();
    
    // تنظيف Three.js objects
    this.clearScene();
    
    // تنظيف الإضاءة والمساعدات
    if (this.scene) {
      const objectsToRemove = [];
      this.scene.traverse((child) => {
        if (child instanceof THREE.Light) {
          if (child.shadow && child.shadow.map) {
            child.shadow.map.dispose();
          }
          objectsToRemove.push(child);
        } else if (child instanceof THREE.GridHelper || child instanceof THREE.AxesHelper) {
          objectsToRemove.push(child);
        }
      });
      
      objectsToRemove.forEach(obj => this.scene.remove(obj));
    }
    
    // تنظيف renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      if (this.container && this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }
    
    // تنظيف المراجع
    this.scene = null;
    this.camera = null;
    this.container = null;
    this.selectedObject = null;
    this.controlState = null;
    
    // تنظيف الرسائل
    this.msg.off('viewport.*');
    this.msg.off('geometry-test.shapeCreated');
    
    console.log('Viewport cleanup complete');
  }
}
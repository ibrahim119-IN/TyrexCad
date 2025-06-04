/**
 * Module Isolation Checker
 * 
 * هذا السكريبت يتحقق من أن جميع الوحدات معزولة تماماً
 * ولا تستورد بعضها البعض
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// الألوان للـ console
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

// قائمة الـ imports المسموح بها
const ALLOWED_IMPORTS = [
  // Node built-ins
  /^node:/,
  /^fs/,
  /^path/,
  /^url/,
  /^crypto/,
  
  // المكتبات الخارجية
  /^three/,
  /^opencascade/,
  /^uuid/,
  
  // الـ core يُسمح باستيراده فقط في main.js
  /^\.\.\/core\//,
  /^\.\/core\//,
  
  // الملفات المحلية داخل نفس الوحدة
  /^\.\//,
];

// الملفات التي يُسمح لها باستيراد الـ core
const CORE_IMPORT_WHITELIST = [
  'main.js',
  'core/message-bus.js',
  'core/module-loader.js',
  'core/lifecycle.js',
  'core/occt-bridge.js',
  'core/security.js'
];

let violations = 0;

/**
 * فحص ملف JavaScript للتحقق من الـ imports
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(projectRoot, filePath);
  
  lines.forEach((line, index) => {
    // البحث عن import statements
    const importMatch = line.match(/import\s+.*from\s+['"](.*)['"]/)
;
    if (!importMatch) return;
    
    const importPath = importMatch[1];
    
    // التحقق من أن الـ import مسموح
    const isAllowed = ALLOWED_IMPORTS.some(pattern => pattern.test(importPath));
    
    // التحقق من استيراد الـ core
    const isCoreImport = /\/core\//.test(importPath) || /^@core/.test(importPath);
    const isInWhitelist = CORE_IMPORT_WHITELIST.includes(relativePath);
    
    if (isCoreImport && !isInWhitelist) {
      console.log(`${colors.red}❌ VIOLATION in ${relativePath}:${index + 1}${colors.reset}`);
      console.log(`   Importing core module: ${importPath}`);
      console.log(`   Only main.js and core modules can import from core!`);
      violations++;
      return;
    }
    
    // التحقق من استيراد وحدات أخرى
    const isModuleImport = /\.\.\/[^/]+\//.test(importPath) && !isCoreImport;
    if (isModuleImport && !isAllowed) {
      console.log(`${colors.red}❌ VIOLATION in ${relativePath}:${index + 1}${colors.reset}`);
      console.log(`   Cross-module import detected: ${importPath}`);
      console.log(`   Modules must communicate via messages only!`);
      violations++;
    }
  });
}

/**
 * فحص مجلد بشكل recursively
 */
function checkDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  entries.forEach(entry => {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      // تجاهل node_modules و .git
      if (entry.name === 'node_modules' || entry.name === '.git') return;
      checkDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      checkFile(fullPath);
    }
  });
}

// بدء الفحص
console.log('🔍 Checking module isolation...\n');

// فحص مجلد modules
const modulesPath = path.join(projectRoot, 'modules');
if (fs.existsSync(modulesPath)) {
  checkDirectory(modulesPath);
}

// فحص مجلد plugins
const pluginsPath = path.join(projectRoot, 'plugins');
if (fs.existsSync(pluginsPath)) {
  checkDirectory(pluginsPath);
}

// النتيجة النهائية
console.log('\n' + '='.repeat(50));
if (violations === 0) {
  console.log(`${colors.green}✅ Success! All modules are properly isolated.${colors.reset}`);
  process.exit(0);
} else {
  console.log(`${colors.red}❌ Found ${violations} isolation violation(s).${colors.reset}`);
  console.log('\nRemember: Modules must communicate via messages only!');
  process.exit(1);
}
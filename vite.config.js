/* ============================================================
 * Vite 配置（Vue3 工程骨架）
 *   - dev:    http://localhost:5173（Vite 默认端口）
 *   - build:  产物到 dist/，由 nginx 或 webviz 镜像托管
 *   - 本分支目标：搭骨架并跑通，组件改造逐步推进
 * ------------------------------------------------------------
 * 注：完整工程化（image 替换 webviz）后，将由 docker compose
 *     把 dist/ 挂到 nginx 容器即可，nginx 配置保持不变（/kb/ 路径仍可用）
 * ============================================================ */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import path from 'node:path';

// 开发期代理：浏览器经 vite 反代访问后端，避免 CORS
//   /llm  → SiliconFlow（LLM 反代，旧版由 nginx 注入 Authorization；本地 dev 用 .env）
//   /kb   → 数据原文（兼容 nginx 旧行为，dev 时用本地静态）
const backendProxies = {
  '/llm': {
    target: 'https://api.siliconflow.cn/v1',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/llm/, '')
  }
};

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] })
  ],
  resolve: {
    alias: {
      // 兼容旧代码路径：'@/views/HomeView' 等可直接用
      '@': path.resolve(process.cwd(), 'frontend/src')
    }
  },
  server: {
    port: 5173,
    host: true,
    open: false,
    proxy: backendProxies
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router'],
          'vendor-ep': ['element-plus', '@element-plus/icons-vue'],
          'vendor-vis': ['vis-network', 'vis-data'],
          'vendor-neo4j': ['neo4j-driver']
        }
      }
    }
  }
});

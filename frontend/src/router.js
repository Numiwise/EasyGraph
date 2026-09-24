/* ============================================================
 * Vue Router 4 配置（hash 模式，与旧版保持一致）
 *   /                   → HomeView
 *   /graph/:ws          → GraphView
 *   /query              → QueryView
 *   /doc                → DocView
 * 兼容旧链接：?ws=gxx_... 自动重定向到 /graph/gxx_...
 * ============================================================ */
import { createRouter, createWebHashHistory } from 'vue-router';

import HomeView from './views/HomeView.vue';
import GraphView from './views/GraphView.vue';
import QueryView from './views/QueryView.js';
import DocView from './views/DocView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/graph/:ws', name: 'graph', component: GraphView, props: (route) => ({ ws0: route.params.ws }) },
    { path: '/query', name: 'query', component: QueryView },
    { path: '/doc', name: 'doc', component: DocView }
  ]
});

router.beforeEach((to) => {
  if (to.path === '/' && to.query.ws) {
    return { path: '/graph/' + to.query.ws };
  }
});

export default router;

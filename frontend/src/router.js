/* ============================================================
 * 路由：hash 模式（nginx 零配置，链接可直接分享）
 *   /                    → 导航首页（子图跳转工具）
 *   /graph/:workspace    → 图谱可视化页（g00 总图 / g01~g06 分图）
 * 兼容旧链接：?ws=gxx_... 自动重定向到 /graph/gxx_...
 * ============================================================ */
import HomeView from './views/HomeView.js';
import GraphView from './views/GraphView.js';
import QueryView from './views/QueryView.js';
import DocView from './views/DocView.js';

const { createRouter, createWebHashHistory } = VueRouter;

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/graph/:ws', name: 'graph', component: GraphView, props: (route) => ({ ws0: route.params.ws }) },
    { path: '/query', name: 'query', component: QueryView },
    { path: '/doc', name: 'doc', component: DocView }
  ]
});

// 旧版 ?ws= 直达链接 → 新路由
router.beforeEach((to) => {
  if (to.path === '/' && to.query.ws) {
    return { path: '/graph/' + to.query.ws };
  }
});

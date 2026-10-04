// ============================================================
// fix-auth.js
// ------------------------------------------------------------
// 注入到 LightRAG WebUI HTML 里，修复 1.5.7 SPA 的 auth 流程 bug，
// 让用户无需登录直接使用。
//
// 三大修复：
//   1) fetch 拦截：把所有 /auth-status、/login、/query/data 等相对路径
//      改写到 /lightrag/<workspace>/ 命名空间下（云端 nginx 通过
//      /lightrag/<ws>/ 反代到 lightrag-server:9621）。
//      解决：1.5.7 SPA 用 fetch('/xxx') 绝对路径，与 1.5.6 的 axios baseURL
//      不同，导致云端 fetch 走浏览器同源解析，落不到 nginx 反代上。
//
//   2) localStorage 注入 LIGHTRAG-API-TOKEN：lightrag-server 在 auth_mode
//      =disabled 时返回 guest JWT（access_token 字段）。SPA 的 Px 路由守卫
//      检查 localStorage['LIGHTRAG-API-TOKEN'] 是否存在。我们用 guest JWT
//      作 token 写入，让 isAuthenticated=true。
//
//   3) 定时器兜底：Nx 主组件的 useEffect 因 1.5.7 SPA 代码里 `await Se()`
//      bug（Se 是 useState 字符串而非函数）始终进入 catch，最终 `o(!1)`
//      关闭 loading 但 isAuthenticated 仍为 false，Px 路由守卫就跳 /login。
//      我们用 setInterval 每 200ms 检查一次：如果有 token 但还没登录，
//      就主动调 /auth-status 拿到 access_token 并写入 localStorage，
//      触发 Px 的依赖项重计算 → 渲染 Nx → 用户进入主界面。
//
// 设计：
//   - 不引入任何依赖；纯 vanilla JS
//   - 失败时静默（try/catch 包住）
//   - 多次执行幂等（多次调用不会出问题）
// ============================================================

(function() {
  'use strict';

  // ---- 0. 防止重入（DevTools 刷新 / SPA 切换 hash 时可能重复执行）----
  if (window.__lightragFixAuthInjected) {
    return;
  }
  window.__lightragFixAuthInjected = true;

  // ---- 1. fetch 拦截：把 /xxx 绝对路径改写到 /lightrag/<ws>/xxx ----
  // 注意：这里用一个不会跟 nginx $varname 冲突的变量名（pathStr 而非 url）
  var WORKSPACE_RE = /^\/lightrag\/([^/]+)\//;
  var pathMatch = (window.location.pathname || '').match(WORKSPACE_RE);
  var WORKSPACE_PREFIX = pathMatch ? '/' + pathMatch[0] : '';

  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      var pathStr;
      if (typeof input === 'string') {
        pathStr = input;
      } else if (input && input.url) {
        pathStr = input.url;
      } else {
        pathStr = '';
      }
      // 已经是绝对 URL（http:// / https://）直接放过
      if (/^[a-z][a-z0-9+.-]*:/i.test(pathStr)) {
        return origFetch.apply(this, arguments);
      }
      // 以 / 开头但不是 /lightrag//api//kb//llm/ 的请求
      // 重写为 /lightrag/<ws>/xxx
      if (pathStr.charAt(0) === '/' &&
          !pathStr.startsWith('/lightrag/') &&
          !pathStr.startsWith('/api/') &&
          !pathStr.startsWith('/kb/') &&
          !pathStr.startsWith('/llm/') &&
          !pathStr.startsWith('/__fix-auth.js') &&
          WORKSPACE_PREFIX) {
        var newPath = WORKSPACE_PREFIX.replace(/\/$/, '') + pathStr;
        if (typeof input === 'string') {
          input = newPath;
        } else {
          try { input = new Request(newPath, input); } catch (e) {}
        }
      }
    } catch (e) { /* swallow */ }
    return origFetch.apply(this, arguments);
  };

  // ---- 2. localStorage 兜底写入 token（如果还没写） ----
  function ensureToken() {
    var existing = null;
    try { existing = localStorage.getItem('LIGHTRAG-API-TOKEN'); } catch (e) {}
    if (existing) return Promise.resolve(existing);

    // 没 token：先 fetch /auth-status，拿 guest access_token 写入
    var authUrl = WORKSPACE_PREFIX + '/auth-status';
    return fetch(authUrl).then(function(r) { return r.json(); }).then(function(data) {
      var token = (data && (data.access_token || data.token)) || '';
      if (token) {
        try { localStorage.setItem('LIGHTRAG-API-TOKEN', token); } catch (e) {}
      }
      return token;
    }).catch(function() { return ''; });
  }

  // ---- 3. 定时器兜底：每 200ms 检查并写入 ----
  // 解决 1.5.7 SPA 的 Se() bug：Nx 主组件的 useEffect 因 Se() TypeError 永远
  // 进入 catch，loading 状态会被关闭（o(!1)），但 isAuthenticated 仍为 false，
  // Px 路由守卫随即跳 /login。这里我们主动抓 /auth-status、写 token，让
  // SPA 自己处理后续状态变化。
  var tickCount = 0;
  var MAX_TICKS = 30; // 最多跑 6 秒
  var intervalId = setInterval(function() {
    tickCount++;
    if (tickCount > MAX_TICKS) {
      clearInterval(intervalId);
      return;
    }
    var hash = window.location.hash || '';
    // 如果用户已经在 /login 页面（弹窗已弹出），不要打扰
    if (hash.indexOf('/login') !== -1) {
      // 我们主动跳走（强制进入主界面）
      // 只有当 token 有效时才跳
      var tok = null;
      try { tok = localStorage.getItem('LIGHTRAG-API-TOKEN'); } catch (e) {}
      if (tok) {
        // 强制 reload 一次：让 Px 路由守卫看到 token + isAuthenticated=true
        window.location.hash = '#/';
        // 也强制触发 SPA 重渲染：派发 hashchange
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      return;
    }
    ensureToken();
  }, 200);

  // ---- 4. 立即执行一次 ----
  ensureToken();
})();

// ============================================================
// fix-auth.js
// ------------------------------------------------------------
// 注入到 LightRAG WebUI HTML 里，修复 1.5.7 SPA 的 auth 流程 bug，
// 让用户无需登录直接使用。
//
// 两大修复：
//   1) localStorage 注入 LIGHTRAG-API-TOKEN：lightrag-server 在 auth_mode
//      =disabled 时返回 guest JWT（access_token 字段）。SPA 的 Px 路由守卫
//      检查 localStorage['LIGHTRAG-API-TOKEN'] 是否存在。我们用 guest JWT
//      作 token 写入，让 isAuthenticated=true。
//
//   2) 定时器兜底：Nx 主组件的 useEffect 因 1.5.7 SPA 代码里 `await Se()`
//      bug（Se 是 useState 字符串而非函数）始终进入 catch，最终 `o(!1)`
//      关闭 loading 但 isAuthenticated 仍为 false，Px 路由守卫就跳 /login。
//      我们用 setInterval 持续检查并写 token，触发 Px 重计算。
//
// nginx sub_filter 已自动注入：
//   "apiPrefix": ""  →  "apiPrefix": "/lightrag/<ws>/"
// 因此 SPA 内部 fetch('/auth-status') 会自动拼成 /lightrag/<ws>/auth-status，
// 我们不需要在浏览器里做 fetch 拦截。
//
// 设计：
//   - 不引入任何依赖；纯 vanilla JS
//   - 失败时静默（try/catch 包住）
//   - 多次执行幂等（多次调用不会出问题）
//   - 不会污染 nginx 配置（无需 $varname，无 envsubst 问题）
// ============================================================

(function() {
  'use strict';

  if (window.__lightragFixAuthInjected) {
    return;
  }
  window.__lightragFixAuthInjected = true;

  // 读取 SPA 的 apiPrefix（被 nginx sub_filter 注入为 /lightrag/<ws>/）
  var cfg = window.__LIGHTRAG_CONFIG__ || {};
  var apiPrefix = (cfg.apiPrefix || '').replace(/\/$/, '');

  // ---- 1. 写入 token（如果还没写） ----
  function ensureToken() {
    var existing = null;
    try { existing = localStorage.getItem('LIGHTRAG-API-TOKEN'); } catch (e) {}
    if (existing) return Promise.resolve(existing);

    // 没 token：fetch /auth-status 拿 guest access_token，写入 localStorage
    var authUrl = apiPrefix + '/auth-status';
    return fetch(authUrl).then(function(r) { return r.json(); }).then(function(data) {
      var token = (data && (data.access_token || data.token)) || '';
      if (token) {
        try { localStorage.setItem('LIGHTRAG-API-TOKEN', token); } catch (e) {}
      }
      return token;
    }).catch(function() { return ''; });
  }

  // ---- 2. 定时器兜底：每 200ms 检查并写入 token ----
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
    // 如果用户已经被弹到 /login 页面，我们强制跳回主界面
    if (hash.indexOf('/login') !== -1) {
      var tok = null;
      try { tok = localStorage.getItem('LIGHTRAG-API-TOKEN'); } catch (e) {}
      if (tok) {
        // 强制跳到根路由
        window.location.hash = '#/';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      return;
    }
    ensureToken();
  }, 200);

  // ---- 3. 立即执行一次 ----
  ensureToken();
})();

// 在首屏渲染前确定主题：默认浅色，用户在顶栏切换过则沿用其选择
(() => {
  let choice = null;
  try { choice = localStorage.getItem("legal-theme"); } catch { /* 存储不可用时使用默认浅色 */ }
  document.documentElement.dataset.theme = choice === "dark" ? "dark" : "light";
})();

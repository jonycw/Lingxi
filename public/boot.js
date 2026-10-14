(function () {
  var theme = localStorage.getItem('lingxi.theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  var lang = localStorage.getItem('lingxi.lang') || 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
})();

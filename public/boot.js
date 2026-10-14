(function () {
  var stored = localStorage.getItem('lingxi.theme');
  var shell = document.documentElement.getAttribute('data-shell');
  var theme = stored === 'light' || stored === 'dark' ? stored : shell === 'ide' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  var lang = localStorage.getItem('lingxi.lang') || 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
})();

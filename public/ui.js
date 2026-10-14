const STRINGS = {
  zh: {
    adminTitle: '管理台',
    userTitle: '对话台',
    home: '首页',
    customers: '客户',
    prices: '价格',
    usage: '用量',
    chat: '对话',
    account: '账户',
    loginTitle: '登录管理台',
    loginUserTitle: '登录对话台',
    loginHint: '使用服务器上的 ADMIN_TOKEN。令牌只保存在当前标签页。',
    userHint: '粘贴管理员发给你的 lx_ 密钥。密钥只保存在当前标签页。',
    token: '管理员令牌',
    apiKey: '客户密钥',
    signIn: '进入',
    signOut: '退出',
    lang: 'English',
    themeToDark: '深色',
    themeToLight: '浅色',
    createCustomer: '新建客户',
    name: '名称',
    email: '邮箱',
    credits: '初始积分',
    save: '保存',
    create: '创建',
    balance: '余额',
    status: '状态',
    actions: '操作',
    manage: '管理',
    back: '返回客户列表',
    creditTitle: '充值',
    creditAmount: '增加积分',
    note: '备注',
    addCredit: '入账',
    issueKey: '签发密钥',
    keyName: '密钥名称',
    issue: '签发',
    revoke: '吊销',
    prefix: '前缀',
    rpm: '每分钟请求',
    lastUsed: '最近使用',
    active: '有效',
    revoked: '已吊销',
    suspended: '已暂停',
    suspend: '暂停客户',
    activate: '恢复客户',
    keyOnce: '请立即复制。关闭后无法再次查看完整密钥。',
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败，请手动选择文本',
    confirmRevoke: '吊销后该密钥立即失效。继续？',
    emptyCustomers: '还没有客户。',
    emptyKeys: '还没有密钥。',
    emptyUsage: '还没有用量。',
    model: '模型',
    upstream: '上游模型',
    enabled: '启用',
    inputPrice: '输入价 / 百万 token',
    outputPrice: '输出价 / 百万 token',
    resetPrice: '恢复文件价格',
    requests: '请求数',
    tokens: 'Token',
    cost: '费用（微积分）',
    refresh: '刷新',
    optional: '可选',
    quota: '本周期配额',
    soft: '软配额',
    hard: '硬配额',
    period: '周期',
    recent: '最近调用',
    prompt: '输入',
    completion: '输出',
    send: '发送',
    stream: '流式输出',
    message: '消息',
    you: '你',
    assistant: '灵犀',
    thinking: '正在生成…',
    mock: '模拟上游',
    proxy: '已连接上游',
    noModels: '没有可用模型。',
    unlimited: '不限',
    keyPrefix: '密钥',
    dashboard: '总览',
    keys: '密钥',
    navCredits: '积分',
    upstream: '上游',
    system: '系统',
    newChat: '新对话',
    chats: '历史对话',
    baseUrl: '上游地址',
    upstreamKey: '上游密钥',
    mockToggle: '模拟模式',
    saveUpstream: '保存并立即生效',
    resetUpstream: '恢复为环境变量',
    keyMissing: '未设置',
    sourceSettings: '已保存设置',
    sourceEnv: '环境变量',
    sourceNone: '未设置',
    effectiveMode: '当前生效',
    modelMap: '模型映射',
    fileUpstream: '文件默认',
    liveUpstream: '上游模型名',
    customerName: '客户',
    emptyChats: '还没有对话',
    upstreamHint: '环境变量只是启动默认值。保存后写入数据库并立即生效，无需重启。密钥只写不回显，读取时仅显示末四位。',
    systemHint: '数据文件里会保存上游密钥。请保护 data/ 目录，不要把数据库提交到仓库。',
    maskedKey: '已设置，末四位',
    keepKey: '留空表示不修改密钥',
    clearKey: '清除已保存的密钥',
    applyNow: '保存后下一通对话即使用新上游。',
    noKeyHint: '模拟开关已关闭，但没有密钥，对话仍走本地模拟。',
    dashboardCustomers: '客户数',
    dashboardKeys: '密钥数',
    dashboardRequests: '用量行',
    envBootstrap: '启动时读取 .env。管理台里的上游设置会覆盖它。',
    deleteChat: '删除',
    accountShort: '余额与用量',
  },
  en: {
    adminTitle: 'Admin',
    userTitle: 'Console',
    home: 'Home',
    customers: 'Customers',
    prices: 'Prices',
    usage: 'Usage',
    chat: 'Chat',
    account: 'Account',
    loginTitle: 'Admin sign in',
    loginUserTitle: 'Customer sign in',
    loginHint: 'Use the server ADMIN_TOKEN. It stays in this tab only.',
    userHint: 'Paste the lx_ key issued to you. It stays in this tab only.',
    token: 'Admin token',
    apiKey: 'API key',
    signIn: 'Continue',
    signOut: 'Sign out',
    lang: '中文',
    themeToDark: 'Dark',
    themeToLight: 'Light',
    createCustomer: 'New customer',
    name: 'Name',
    email: 'Email',
    credits: 'Opening credits',
    save: 'Save',
    create: 'Create',
    balance: 'Balance',
    status: 'Status',
    actions: 'Actions',
    manage: 'Open',
    back: 'All customers',
    creditTitle: 'Add credit',
    creditAmount: 'Credits to add',
    note: 'Note',
    addCredit: 'Credit',
    issueKey: 'Issue a key',
    keyName: 'Key name',
    issue: 'Issue',
    revoke: 'Revoke',
    prefix: 'Prefix',
    rpm: 'Requests / min',
    lastUsed: 'Last used',
    active: 'Active',
    revoked: 'Revoked',
    suspended: 'Suspended',
    suspend: 'Suspend',
    activate: 'Reactivate',
    keyOnce: 'Copy this key now. It will not be shown again.',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed. Select the text manually.',
    confirmRevoke: 'This key stops working immediately. Continue?',
    emptyCustomers: 'No customers yet.',
    emptyKeys: 'No keys yet.',
    emptyUsage: 'No usage yet.',
    model: 'Model',
    upstream: 'Upstream',
    enabled: 'Enabled',
    inputPrice: 'Input / 1M tokens',
    outputPrice: 'Output / 1M tokens',
    resetPrice: 'Reset to file',
    requests: 'Requests',
    tokens: 'Tokens',
    cost: 'Cost (micros)',
    refresh: 'Refresh',
    optional: 'optional',
    quota: 'Quota this period',
    soft: 'Soft quota',
    hard: 'Hard quota',
    period: 'Period',
    recent: 'Recent calls',
    prompt: 'Prompt',
    completion: 'Completion',
    send: 'Send',
    stream: 'Stream',
    message: 'Message',
    you: 'You',
    assistant: 'Lingxi',
    thinking: 'Generating…',
    mock: 'Mock upstream',
    proxy: 'Upstream connected',
    noModels: 'No models are enabled.',
    unlimited: 'Unlimited',
    keyPrefix: 'Key',
    dashboard: 'Dashboard',
    keys: 'Keys',
    navCredits: 'Credits',
    upstream: 'Upstream',
    system: 'System',
    newChat: 'New chat',
    chats: 'History',
    baseUrl: 'Base URL',
    upstreamKey: 'Upstream key',
    mockToggle: 'Mock mode',
    saveUpstream: 'Save and apply',
    resetUpstream: 'Reset to environment',
    keyMissing: 'Not set',
    sourceSettings: 'Saved settings',
    sourceEnv: 'Environment',
    sourceNone: 'Not set',
    effectiveMode: 'Effective',
    modelMap: 'Model mapping',
    fileUpstream: 'File default',
    liveUpstream: 'Upstream model',
    customerName: 'Customer',
    emptyChats: 'No chats yet',
    upstreamHint: 'Environment variables are only the bootstrap defaults. Saving writes to the database and applies immediately, without a restart. The key is write-only and only the last four characters are shown.',
    systemHint: 'The database stores the upstream key. Protect the data directory and do not commit it.',
    maskedKey: 'Set, last four',
    keepKey: 'Leave blank to keep the current key',
    clearKey: 'Clear the saved key',
    applyNow: 'The next chat uses the saved upstream.',
    noKeyHint: 'Mock is off, but no key is set, so chat stays on the local mock.',
    dashboardCustomers: 'Customers',
    dashboardKeys: 'Keys',
    dashboardRequests: 'Usage rows',
    envBootstrap: 'The process starts from .env. Upstream settings saved here override it.',
    deleteChat: 'Delete',
    accountShort: 'Balance and usage',
  },
};

export function lang() {
  return localStorage.getItem('lingxi.lang') === 'en' ? 'en' : 'zh';
}

export function t(key) {
  return STRINGS[lang()][key] ?? STRINGS.zh[key] ?? key;
}

export function setLang(next) {
  localStorage.setItem('lingxi.lang', next === 'en' ? 'en' : 'zh');
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
}

export function theme() {
  const stored = localStorage.getItem('lingxi.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return document.documentElement.getAttribute('data-shell') === 'ide' ? 'dark' : 'light';
}

export function setTheme(next) {
  localStorage.setItem('lingxi.theme', next);
  document.documentElement.setAttribute('data-theme', next);
}

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleString(lang() === 'zh' ? 'zh-CN' : 'en');
}

export function statusLabel(status) {
  if (status === 'active') return t('active');
  if (status === 'revoked') return t('revoked');
  if (status === 'suspended') return t('suspended');
  return esc(status);
}

export function badge(status) {
  const kind = status === 'active' ? '' : status === 'suspended' ? 'warn' : 'danger';
  return `<span class="badge ${kind}">${esc(statusLabel(status))}</span>`;
}

export function createClient(storageKey) {
  return {
    token() {
      return sessionStorage.getItem(storageKey) || '';
    },
    setToken(value) {
      sessionStorage.setItem(storageKey, value);
    },
    clear() {
      sessionStorage.removeItem(storageKey);
    },
    async request(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (this.token()) headers.set('Authorization', `Bearer ${this.token()}`);
      if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetch(path, { ...options, headers });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: { message: text.slice(0, 180) } };
        }
      }
      if (!response.ok) {
        const error = new Error(data?.error?.message || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    },
  };
}

export async function loadHealth() {
  try {
    const response = await fetch('/health');
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function shell({ title, health, signedIn }) {
  const mode = health?.upstream === 'proxy' ? t('proxy') : health?.upstream === 'mock' ? t('mock') : '';
  return `
    <header class="topbar">
      <a class="brand" href="/">灵犀<small>LINGXI</small></a>
      <div>
        <strong>${esc(title)}</strong>
        ${mode ? `<div class="muted">${esc(mode)}</div>` : ''}
      </div>
      <div class="spacer"></div>
      <div class="cluster">
        <button class="button button-ghost" type="button" data-action="lang">${esc(t('lang'))}</button>
        <button class="button button-ghost" type="button" data-action="theme">${esc(theme() === 'dark' ? t('themeToLight') : t('themeToDark'))}</button>
        ${signedIn ? `<button class="button button-ghost" type="button" data-action="logout">${esc(t('signOut'))}</button>` : ''}
      </div>
    </header>
  `;
}

export function toolbar({ signedIn }) {
  return `
    <div class="toolbar">
      <div class="spacer"></div>
      <button class="button button-ghost" type="button" data-action="lang">${esc(t('lang'))}</button>
      <button class="button button-ghost" type="button" data-action="theme">${esc(theme() === 'dark' ? t('themeToLight') : t('themeToDark'))}</button>
      ${signedIn ? `<button class="button button-ghost" type="button" data-action="logout">${esc(t('signOut'))}</button>` : ''}
    </div>`;
}

export function sourceLabel(source) {
  if (source === 'settings') return t('sourceSettings');
  if (source === 'env') return t('sourceEnv');
  return t('sourceNone');
}

export function banner(error, notice) {
  if (error) return `<div class="banner" role="alert">${esc(error)}</div>`;
  if (notice) return `<div class="banner ok" role="status">${esc(notice)}</div>`;
  return '';
}

export async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection fallback for non-secure origins.
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function mountChrome(onAction) {
  document.body.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target) return;
    onAction(target.dataset.action || '', target, event);
  });
}

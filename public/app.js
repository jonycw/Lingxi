import {
  banner,
  createClient,
  esc,
  formatWhen,
  lang,
  loadHealth,
  mountChrome,
  setLang,
  setTheme,
  shell,
  t,
  theme,
} from './ui.js';

const client = createClient('lingxi.user.token');
const state = {
  health: null,
  authed: false,
  view: 'chat',
  me: null,
  usage: [],
  models: [],
  messages: [],
  error: '',
  notice: '',
  busy: false,
};

const app = document.querySelector('#app');

function render() {
  if (!state.authed) {
    app.innerHTML = `
      <main class="login card">
        ${shell({ title: t('userTitle'), health: state.health, signedIn: false })}
        <h2>${esc(t('loginUserTitle'))}</h2>
        <p class="muted">${esc(t('userHint'))}</p>
        ${banner(state.error, '')}
        <form data-form="login">
          <label>${esc(t('apiKey'))}
            <input name="key" type="password" autocomplete="off" spellcheck="false" required placeholder="lx_" />
          </label>
          <button class="button" type="submit">${esc(t('signIn'))}</button>
        </form>
      </main>`;
    return;
  }
  app.innerHTML = `
    <div class="shell">
      ${shell({ title: t('userTitle'), health: state.health, signedIn: true })}
      <nav class="nav">
        <button class="button button-ghost" type="button" data-action="nav" data-view="chat" ${state.view === 'chat' ? 'aria-current="page"' : ''}>${esc(t('chat'))}</button>
        <button class="button button-ghost" type="button" data-action="nav" data-view="account" ${state.view === 'account' ? 'aria-current="page"' : ''}>${esc(t('account'))}</button>
      </nav>
      ${banner(state.error, state.notice)}
      ${state.view === 'chat' ? chatView() : accountView()}
    </div>`;
  const box = document.querySelector('.transcript');
  if (box) box.scrollTop = box.scrollHeight;
}

function quotaText(value) {
  return value === null || value === undefined ? t('unlimited') : String(value);
}

function accountView() {
  const me = state.me;
  const quota = me?.quota || {};
  const rows = state.usage
    .map(
      (row) => `<tr>
        <td>${esc(formatWhen(row.created_at))}</td>
        <td><code>${esc(row.model)}</code></td>
        <td class="num">${esc(row.total_tokens)}</td>
        <td class="num">${esc(row.cost_micros)}</td>
        <td>${esc(row.status)}</td>
      </tr>`,
    )
    .join('');
  return `
    <section class="stats">
      <div class="stat"><span>${esc(t('balance'))}</span><b>${esc(me?.customer?.balance_credits ?? '0')}</b></div>
      <div class="stat"><span>${esc(t('tokens'))}</span><b>${esc(quota.total_tokens ?? 0)}</b></div>
      <div class="stat"><span>${esc(t('keyPrefix'))}</span><b>${esc(me?.api_key?.prefix ?? '')}</b></div>
    </section>
    <section class="card">
      <p class="muted">${esc(me?.customer?.name || '')} · ${esc(t('period'))} ${esc(quota.period_key || '')}</p>
      <p class="muted">${esc(t('soft'))}: ${esc(quotaText(quota.soft_quota_tokens))} · ${esc(t('hard'))}: ${esc(quotaText(quota.hard_quota_tokens))}</p>
      <h2>${esc(t('recent'))}</h2>
      ${
        rows
          ? `<div class="table-wrap"><table>
              <thead><tr><th>${esc(t('lastUsed'))}</th><th>${esc(t('model'))}</th><th class="num">${esc(t('tokens'))}</th><th class="num">${esc(t('cost'))}</th><th>${esc(t('status'))}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          : `<p class="muted">${esc(t('emptyUsage'))}</p>`
      }
    </section>`;
}

function chatView() {
  const options = state.models
    .map((model) => `<option value="${esc(model.id)}">${esc(model.id)}</option>`)
    .join('');
  const bubbles = state.messages
    .map(
      (message, index) => `<div class="bubble ${message.role === 'user' ? 'user' : 'assistant'}" ${index === state.messages.length - 1 && message.role === 'assistant' ? 'data-stream="1"' : ''}>
        <span class="who">${esc(message.role === 'user' ? t('you') : t('assistant'))}</span>${esc(message.content || (state.busy ? t('thinking') : ''))}
      </div>`,
    )
    .join('');
  return `
    <section class="card">
      <div class="transcript">${bubbles || `<p class="muted">${esc(t('message'))}</p>`}</div>
      <form data-form="chat">
        <div class="form-row">
          <label>${esc(t('model'))}
            <select name="model" ${state.models.length ? '' : 'disabled'}>${options}</select>
          </label>
          <label class="check"><input type="checkbox" name="stream" checked /> ${esc(t('stream'))}</label>
        </div>
        <div class="composer">
          <label>${esc(t('message'))}<textarea name="content" required></textarea></label>
          <button class="button" type="submit" ${state.busy || !state.models.length ? 'disabled' : ''}>${esc(t('send'))}</button>
        </div>
        ${state.models.length ? '' : `<p class="muted">${esc(t('noModels'))}</p>`}
      </form>
    </section>`;
}

async function refreshAccount() {
  state.me = await client.request('/v1/me');
  const usage = await client.request('/v1/usage?limit=20');
  state.usage = usage.data || [];
  if (!state.me?.customer) state.me = { ...state.me, customer: { balance_credits: usage.balance_credits } };
}

async function guard(work) {
  state.error = '';
  state.busy = true;
  render();
  try {
    await work();
    state.error = '';
  } catch (error) {
    if (error.status === 401) {
      client.clear();
      state.authed = false;
    }
    state.error = error.message || String(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function boot() {
  state.health = await loadHealth();
  if (!client.token()) {
    render();
    return;
  }
  await guard(async () => {
    state.models = (await client.request('/v1/models')).data || [];
    await refreshAccount();
    state.authed = true;
  });
}

function paintStream(text) {
  const node = document.querySelector('[data-stream="1"]');
  if (!node) return;
  const who = node.querySelector('.who');
  node.textContent = '';
  if (who) node.appendChild(who);
  node.append(text || t('thinking'));
  const box = document.querySelector('.transcript');
  if (box) box.scrollTop = box.scrollHeight;
}

async function readSse(response, onDelta) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') {
        try {
          const payload = JSON.parse(data);
          const choices = Array.isArray(payload.choices) ? payload.choices : [];
          for (const choice of choices) {
            const delta = choice?.delta?.content;
            if (typeof delta === 'string') content += delta;
          }
          onDelta(content);
        } catch {
          // Ignore a malformed keep-alive chunk.
        }
      }
      split = buffer.indexOf('\n\n');
    }
  }
  return content;
}

mountChrome((action, target) => {
  if (action === 'lang') {
    setLang(lang() === 'zh' ? 'en' : 'zh');
    render();
    return;
  }
  if (action === 'theme') {
    setTheme(theme() === 'dark' ? 'light' : 'dark');
    render();
    return;
  }
  if (action === 'logout') {
    client.clear();
    state.authed = false;
    state.messages = [];
    state.error = '';
    state.notice = '';
    render();
    return;
  }
  if (action === 'nav') {
    if (!state.authed) return;
    state.view = target.dataset.view || 'chat';
    state.error = '';
    state.notice = '';
    if (state.view === 'account') {
      void guard(refreshAccount);
      return;
    }
    render();
  }
});

app.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.dataset.form === 'login') {
    client.setToken(String(data.get('key') || '').trim());
    void guard(async () => {
      state.models = (await client.request('/v1/models')).data || [];
      await refreshAccount();
      state.authed = true;
      state.view = 'chat';
    });
    return;
  }
  if (form.dataset.form === 'chat') {
    const content = String(data.get('content') || '').trim();
    const model = String(data.get('model') || '');
    const stream = data.get('stream') === 'on';
    if (!content || !model) return;
    state.messages.push({ role: 'user', content });
    state.messages.push({ role: 'assistant', content: '' });
    state.busy = true;
    state.error = '';
    render();
    void (async () => {
      try {
        const response = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${client.token()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            stream,
            messages: state.messages.filter((message) => message.role === 'user' || message.content).map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
        });
        if (!response.ok) {
          const text = await response.text();
          let message = text;
          try {
            message = JSON.parse(text)?.error?.message || text;
          } catch {
            message = text;
          }
          const error = new Error(message || `HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const last = state.messages[state.messages.length - 1];
        if (stream) {
          last.content = (await readSse(response, (text) => {
            last.content = text;
            paintStream(text);
          })) || last.content;
        } else {
          const body = await response.json();
          last.content = body?.choices?.[0]?.message?.content || '';
        }
        await refreshAccount();
      } catch (error) {
        if (error.status === 401) {
          client.clear();
          state.authed = false;
        }
        state.error = error.message || String(error);
        const last = state.messages[state.messages.length - 1];
        if (last && last.role === 'assistant' && !last.content) state.messages.pop();
      } finally {
        state.busy = false;
        render();
      }
    })();
  }
});

void boot();

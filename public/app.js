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
  t,
  theme,
  toolbar,
} from './ui.js';

const client = createClient('lingxi.user.token');
const HISTORY_KEY = 'lingxi.chats.v1';
const state = {
  health: null,
  authed: false,
  view: 'chat',
  me: null,
  usage: [],
  models: [],
  model: '',
  skills: [],
  selectedSkillIds: [],
  messages: [],
  chats: [],
  activeId: '',
  error: '',
  notice: '',
  busy: false,
};

const app = document.querySelector('#app');

function loadChats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.chats.slice(0, 30)));
}

function snapshot() {
  if (!state.messages.some((message) => message.role === 'user' && message.content)) return;
  if (!state.activeId) state.activeId = crypto.randomUUID();
  const title = state.messages.find((message) => message.role === 'user' && message.content)?.content.slice(0, 28) || t('newChat');
  const row = {
    id: state.activeId,
    title,
    messages: state.messages.filter((message) => message.content),
    model: state.model,
    skillIds: state.selectedSkillIds.slice(),
    updatedAt: new Date().toISOString(),
  };
  const index = state.chats.findIndex((chat) => chat.id === state.activeId);
  if (index >= 0) state.chats.splice(index, 1);
  state.chats.unshift(row);
  state.chats = state.chats.slice(0, 30);
  persist();
}

function render() {
  if (!state.authed) {
    app.innerHTML = `
      <main class="ide-login">
        <section class="card">
          ${toolbar({ signedIn: false })}
          <h2>${esc(t('loginUserTitle'))}</h2>
          <p class="muted">${esc(t('userHint'))}</p>
          ${banner(state.error, '')}
          <form data-form="login">
            <label>${esc(t('apiKey'))}
              <input name="key" type="password" autocomplete="off" spellcheck="false" required placeholder="lx_" />
            </label>
            <button class="button" type="submit">${esc(t('signIn'))}</button>
          </form>
        </section>
      </main>`;
    return;
  }
  app.innerHTML = `
    <div class="ide">
      <aside class="ide-side">
        <a class="ide-brand" href="/">灵犀</a>
        <button class="button" type="button" data-action="new-chat">${esc(t('newChat'))}</button>
        <div class="ide-chats">
          ${
            state.chats.length
              ? state.chats
                  .map(
                    (chat) => `<div class="ide-chat">
                      <button class="chat-open" type="button" data-action="open-chat" data-id="${esc(chat.id)}" ${chat.id === state.activeId ? 'aria-current="page"' : ''}>${esc(chat.title)}</button>
                      <button class="icon-button" type="button" data-action="delete-chat" data-id="${esc(chat.id)}" aria-label="${esc(t('deleteChat'))}">×</button>
                    </div>`,
                  )
                  .join('')
              : `<p class="muted">${esc(t('emptyChats'))}</p>`
          }
        </div>
        <div class="ide-foot">
          <button class="button button-ghost" type="button" data-action="nav" data-view="account" ${state.view === 'account' ? 'aria-current="page"' : ''}>${esc(t('account'))}</button>
          <button class="button button-ghost" type="button" data-action="nav" data-view="chat" ${state.view === 'chat' ? 'aria-current="page"' : ''}>${esc(t('chat'))}</button>
        </div>
      </aside>
      <section class="ide-main">
        ${toolbar({ signedIn: true })}
        ${state.view === 'account' ? accountPane() : chatPane()}
      </section>
    </div>`;
  const box = document.querySelector('.ide-stream');
  if (box) box.scrollTop = box.scrollHeight;
}

function quotaText(value) {
  return value === null || value === undefined ? t('unlimited') : String(value);
}

function accountPane() {
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
    <div class="ide-stream">
      <div class="ide-column">
        ${banner(state.error, state.notice)}
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
        </section>
      </div>
    </div>`;
}

function chatPane() {
  const options = state.models
    .map((model) => `<option value="${esc(model.id)}" ${model.id === state.model ? 'selected' : ''}>${esc(model.id)}</option>`)
    .join('');
  const bubbles = state.messages
    .map((message, index) => {
      const streaming = index === state.messages.length - 1 && message.role === 'assistant' ? 'data-stream="1"' : '';
      const text = message.content || (state.busy ? t('thinking') : '');
      if (message.role === 'user') {
        return `<div class="msg msg-user" ${streaming}><span class="who">${esc(t('you'))}</span>${esc(text)}</div>`;
      }
      return `<div class="msg msg-assistant" ${streaming}><span class="who">${esc(t('assistant'))}</span>${esc(text)}</div>`;
    })
    .join('');
  return `
    <div class="ide-stream">
      <div class="ide-column">
        ${banner(state.error, state.notice)}
        ${bubbles || `<p class="muted">${esc(t('message'))}</p>`}
      </div>
    </div>
    <form class="composer-dock" data-form="chat">
      <div class="ide-column composer-box">
        <label>${esc(t('message'))}<textarea name="content" required placeholder="${esc(t('message'))}"></textarea></label>
        <div class="skill-picks">
          <span class="muted">${esc(t('skillPicks'))}</span>
          ${
            state.skills.length
              ? state.skills
                  .map(
                    (skill) => `<label class="check" title="${esc(skill.description)}">
                      <input type="checkbox" name="skill" value="${esc(skill.id)}" ${state.selectedSkillIds.includes(skill.id) ? 'checked' : ''} />
                      ${esc(skill.name)}
                    </label>`,
                  )
                  .join('')
              : `<span class="muted">${esc(t('noSkills'))}</span>`
          }
        </div>
        <div class="composer-tools">
          <label>${esc(t('model'))}
            <select name="model" ${state.models.length ? '' : 'disabled'}>${options}</select>
          </label>
          <label class="check"><input type="checkbox" name="stream" checked /> ${esc(t('stream'))}</label>
          <button class="button" type="submit" ${state.busy || !state.models.length ? 'disabled' : ''}>${esc(t('send'))}</button>
        </div>
        ${state.models.length ? '' : `<p class="muted">${esc(t('noModels'))}</p>`}
      </div>
    </form>`;
}

function knownSkillIds(ids) {
  const allowed = new Set(state.skills.map((skill) => skill.id));
  return ids.filter((id) => allowed.has(id));
}

async function refreshSkills() {
  state.skills = (await client.request('/v1/skills')).data || [];
  state.selectedSkillIds = knownSkillIds(state.selectedSkillIds);
}

async function refreshAccount() {
  state.me = await client.request('/v1/me');
  const usage = await client.request('/v1/usage?limit=20');
  state.usage = usage.data || [];
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
  state.chats = loadChats();
  state.health = await loadHealth();
  if (!client.token()) {
    render();
    return;
  }
  await guard(async () => {
    state.models = (await client.request('/v1/models')).data || [];
    state.model = state.models[0]?.id || '';
    await refreshSkills();
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
  const box = document.querySelector('.ide-stream');
  if (box) box.scrollTop = box.scrollHeight;
}

async function readSse(response, onDelta) {
  const reader = response.body?.getReader();
  if (!reader) return '';
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
    if (state.view === 'account') {
      void guard(refreshAccount);
      return;
    }
    render();
    return;
  }
  if (action === 'new-chat') {
    snapshot();
    state.activeId = '';
    state.messages = [];
    state.selectedSkillIds = [];
    state.view = 'chat';
    state.error = '';
    render();
    return;
  }
  if (action === 'open-chat' && target.dataset.id) {
    snapshot();
    const chat = state.chats.find((item) => item.id === target.dataset.id);
    if (!chat) return;
    state.activeId = chat.id;
    state.messages = (chat.messages || []).map((message) => ({ ...message }));
    state.selectedSkillIds = knownSkillIds(Array.isArray(chat.skillIds) ? chat.skillIds : []);
    if (chat.model) state.model = chat.model;
    state.view = 'chat';
    render();
    return;
  }
  if (action === 'delete-chat' && target.dataset.id) {
    state.chats = state.chats.filter((chat) => chat.id !== target.dataset.id);
    if (state.activeId === target.dataset.id) {
      state.activeId = '';
      state.messages = [];
    }
    persist();
    render();
  }
});

app.addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.name !== 'skill') return;
  const id = input.value;
  if (input.checked) {
    if (!state.selectedSkillIds.includes(id)) state.selectedSkillIds.push(id);
  } else {
    state.selectedSkillIds = state.selectedSkillIds.filter((item) => item !== id);
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
      state.model = state.models[0]?.id || '';
      await refreshSkills();
      await refreshAccount();
      state.authed = true;
      state.view = 'chat';
    });
    return;
  }
  if (form.dataset.form === 'chat') {
    const content = String(data.get('content') || '').trim();
    const model = String(data.get('model') || state.model || '');
    const stream = data.get('stream') === 'on';
    const picked = knownSkillIds([...data.getAll('skill')].map(String));
    if (!content || !model) return;
    state.model = model;
    state.selectedSkillIds = picked;
    state.messages.push({ role: 'user', content });
    state.messages.push({ role: 'assistant', content: '' });
    state.view = 'chat';
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
            ...(picked.length ? { lingxi_skills: picked } : {}),
            messages: state.messages
              .filter((message) => message.role === 'user' || message.content)
              .map((message) => ({ role: message.role, content: message.content })),
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
          last.content =
            (await readSse(response, (text) => {
              last.content = text;
              paintStream(text);
            })) || last.content;
        } else {
          const body = await response.json();
          last.content = body?.choices?.[0]?.message?.content || '';
        }
        snapshot();
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

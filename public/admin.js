import {
  badge,
  banner,
  copyText,
  createClient,
  esc,
  formatWhen,
  lang,
  loadHealth,
  mountChrome,
  setLang,
  setTheme,
  shell,
  statusLabel,
  t,
  theme,
} from './ui.js';

const client = createClient('lingxi.admin.token');
const state = {
  health: null,
  authed: false,
  view: 'customers',
  customers: [],
  customer: null,
  prices: [],
  summary: [],
  revealed: '',
  error: '',
  notice: '',
  busy: false,
};

const app = document.querySelector('#app');

function money(credits) {
  return esc(credits ?? '0');
}

function render() {
  if (!state.authed) {
    app.innerHTML = `
      <main class="login card">
        ${shell({ title: t('adminTitle'), health: state.health, signedIn: false })}
        <h2>${esc(t('loginTitle'))}</h2>
        <p class="muted">${esc(t('loginHint'))}</p>
        ${banner(state.error, '')}
        <form data-form="login">
          <label>${esc(t('token'))}
            <input name="token" type="password" autocomplete="off" spellcheck="false" required />
          </label>
          <button class="button" type="submit">${esc(t('signIn'))}</button>
        </form>
      </main>`;
    return;
  }

  app.innerHTML = `
    <div class="shell">
      ${shell({ title: t('adminTitle'), health: state.health, signedIn: true })}
      <nav class="nav">
        ${navButton('customers')}
        ${navButton('prices')}
        ${navButton('usage')}
      </nav>
      ${banner(state.error, state.notice)}
      ${state.view === 'customers' ? customersView() : ''}
      ${state.view === 'customer' ? customerView() : ''}
      ${state.view === 'prices' ? pricesView() : ''}
      ${state.view === 'usage' ? usageView() : ''}
    </div>`;
}

function navButton(view) {
  const current = state.view === view || (view === 'customers' && state.view === 'customer');
  return `<button type="button" class="button button-ghost" data-action="nav" data-view="${view}" ${current ? 'aria-current="page"' : ''}>${esc(t(view))}</button>`;
}

function customersView() {
  const rows = state.customers
    .map(
      (customer) => `<tr>
        <td><button class="row-link" type="button" data-action="open" data-id="${esc(customer.id)}">${esc(customer.name)}</button></td>
        <td>${esc(customer.email || '—')}</td>
        <td>${badge(customer.status)}</td>
        <td class="num">${money(customer.balance_credits)}</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="grid-2">
      <section class="card">
        <h2>${esc(t('customers'))}</h2>
        ${
          rows
            ? `<div class="table-wrap"><table>
                <thead><tr><th>${esc(t('name'))}</th><th>${esc(t('email'))}</th><th>${esc(t('status'))}</th><th class="num">${esc(t('balance'))}</th></tr></thead>
                <tbody>${rows}</tbody>
              </table></div>`
            : `<p class="muted">${esc(t('emptyCustomers'))}</p>`
        }
      </section>
      <section class="card">
        <h2>${esc(t('createCustomer'))}</h2>
        <form data-form="create-customer">
          <label>${esc(t('name'))}<input name="name" required maxlength="200" /></label>
          <label>${esc(t('email'))} <span>(${esc(t('optional'))})</span><input name="email" type="email" maxlength="320" /></label>
          <label>${esc(t('credits'))}<input name="credits" type="number" min="0" step="1" value="0" /></label>
          <button class="button" type="submit" ${state.busy ? 'disabled' : ''}>${esc(t('create'))}</button>
        </form>
      </section>
    </div>`;
}

function customerView() {
  const customer = state.customer;
  if (!customer) return `<section class="card"><p class="muted">…</p></section>`;
  const keys = (customer.keys || [])
    .map(
      (key) => `<tr>
        <td>${esc(key.name)}</td>
        <td><code>${esc(key.prefix)}</code></td>
        <td>${badge(key.status)}</td>
        <td class="num">${esc(key.rate_limit_rpm)}</td>
        <td>${esc(formatWhen(key.last_used_at))}</td>
        <td>${key.status === 'active' ? `<button class="button button-danger" type="button" data-action="revoke" data-id="${esc(key.id)}">${esc(t('revoke'))}</button>` : ''}</td>
      </tr>`,
    )
    .join('');
  const nextStatus = customer.status === 'active' ? 'suspended' : 'active';
  return `
    <p><button class="button button-ghost" type="button" data-action="nav" data-view="customers">${esc(t('back'))}</button></p>
    <section class="card">
      <div class="stats">
        <div class="stat"><span>${esc(t('name'))}</span><b>${esc(customer.name)}</b></div>
        <div class="stat"><span>${esc(t('balance'))}</span><b>${money(customer.balance_credits)}</b></div>
        <div class="stat"><span>${esc(t('status'))}</span><b>${esc(statusLabel(customer.status))}</b></div>
      </div>
      <p><button class="button button-ghost" type="button" data-action="status" data-status="${nextStatus}">${esc(nextStatus === 'active' ? t('activate') : t('suspend'))}</button></p>
      ${
        state.revealed
          ? `<div class="banner ok">
              <p>${esc(t('keyOnce'))}</p>
              <div class="secret" id="revealed-key">${esc(state.revealed)}</div>
              <p><button class="button" type="button" data-action="copy">${esc(t('copy'))}</button></p>
            </div>`
          : ''
      }
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>${esc(t('creditTitle'))}</h2>
        <form data-form="credit">
          <label>${esc(t('creditAmount'))}<input name="credits" type="number" min="1" step="1" required /></label>
          <label>${esc(t('note'))}<input name="note" maxlength="500" /></label>
          <button class="button" type="submit">${esc(t('addCredit'))}</button>
        </form>
      </section>
      <section class="card">
        <h2>${esc(t('issueKey'))}</h2>
        <form data-form="issue">
          <label>${esc(t('keyName'))}<input name="name" maxlength="100" placeholder="laptop" /></label>
          <button class="button" type="submit">${esc(t('issue'))}</button>
        </form>
      </section>
    </div>
    <section class="card">
      <h2>${esc(t('keyPrefix'))}</h2>
      ${
        keys
          ? `<div class="table-wrap"><table>
              <thead><tr><th>${esc(t('name'))}</th><th>${esc(t('prefix'))}</th><th>${esc(t('status'))}</th><th class="num">${esc(t('rpm'))}</th><th>${esc(t('lastUsed'))}</th><th></th></tr></thead>
              <tbody>${keys}</tbody>
            </table></div>`
          : `<p class="muted">${esc(t('emptyKeys'))}</p>`
      }
    </section>`;
}

function pricesView() {
  const rows = state.prices
    .map((row) => {
      const effective = row.effective || {};
      return `<tr>
        <td><code>${esc(row.id)}</code></td>
        <td><code>${esc(row.upstream)}</code></td>
        <td>
          <form data-form="price" data-model="${esc(row.id)}">
            <label class="check"><input type="checkbox" name="enabled" ${effective.enabled ? 'checked' : ''} /> ${esc(t('enabled'))}</label>
            <label>${esc(t('inputPrice'))}<input name="input" type="number" min="0" step="1" value="${esc(effective.input_micros_per_million)}" /></label>
            <label>${esc(t('outputPrice'))}<input name="output" type="number" min="0" step="1" value="${esc(effective.output_micros_per_million)}" /></label>
            <div class="cluster">
              <button class="button" type="submit">${esc(t('save'))}</button>
              <button class="button button-ghost" type="button" data-action="reset-price" data-model="${esc(row.id)}">${esc(t('resetPrice'))}</button>
            </div>
          </form>
        </td>
      </tr>`;
    })
    .join('');
  return `<section class="card"><h2>${esc(t('prices'))}</h2><div class="table-wrap"><table>
    <thead><tr><th>${esc(t('model'))}</th><th>${esc(t('upstream'))}</th><th>${esc(t('actions'))}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></section>`;
}

function usageView() {
  const rows = state.summary
    .map(
      (row) => `<tr>
        <td><code>${esc(row.key_prefix)}</code></td>
        <td><code>${esc(row.model)}</code></td>
        <td class="num">${esc(row.requests)}</td>
        <td class="num">${esc(row.total_tokens)}</td>
        <td class="num">${esc(row.cost_micros)}</td>
      </tr>`,
    )
    .join('');
  return `<section class="card">
    <div class="cluster"><h2>${esc(t('usage'))}</h2><button class="button button-ghost" type="button" data-action="refresh-usage">${esc(t('refresh'))}</button></div>
    ${
      rows
        ? `<div class="table-wrap"><table>
            <thead><tr><th>${esc(t('keyPrefix'))}</th><th>${esc(t('model'))}</th><th class="num">${esc(t('requests'))}</th><th class="num">${esc(t('tokens'))}</th><th class="num">${esc(t('cost'))}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
        : `<p class="muted">${esc(t('emptyUsage'))}</p>`
    }
  </section>`;
}

async function guard(work) {
  state.error = '';
  state.busy = true;
  try {
    await work();
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

async function loadCustomers() {
  const body = await client.request('/admin/customers?limit=100');
  state.customers = body.data || [];
}

async function openCustomer(id, keepReveal) {
  const body = await client.request(`/admin/customers/${id}`);
  state.customer = body;
  state.view = 'customer';
  if (!keepReveal) state.revealed = '';
}

async function boot() {
  state.health = await loadHealth();
  if (!client.token()) {
    render();
    return;
  }
  await guard(async () => {
    await loadCustomers();
    state.authed = true;
    state.error = '';
  });
}

mountChrome(async (action, target) => {
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
    state.customer = null;
    state.revealed = '';
    state.error = '';
    state.notice = '';
    render();
    return;
  }
  if (action === 'nav') {
    state.notice = '';
    state.error = '';
    state.view = target.dataset.view || 'customers';
    await guard(async () => {
      if (state.view === 'customers') await loadCustomers();
      if (state.view === 'prices') state.prices = (await client.request('/admin/prices')).data || [];
      if (state.view === 'usage') state.summary = (await client.request('/admin/usage/summary')).data || [];
    });
    return;
  }
  if (action === 'open' && target.dataset.id) {
    await guard(() => openCustomer(target.dataset.id, false));
    return;
  }
  if (action === 'copy') {
    const ok = await copyText(state.revealed);
    state.notice = ok ? t('copied') : t('copyFailed');
    state.error = '';
    render();
    return;
  }
  if (action === 'revoke' && target.dataset.id) {
    if (!window.confirm(t('confirmRevoke'))) return;
    await guard(async () => {
      await client.request(`/admin/keys/${target.dataset.id}/revoke`, { method: 'POST' });
      if (state.customer?.id) await openCustomer(state.customer.id, true);
    });
    return;
  }
  if (action === 'status' && state.customer) {
    await guard(async () => {
      await client.request(`/admin/customers/${state.customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: target.dataset.status }),
      });
      await openCustomer(state.customer.id, true);
    });
    return;
  }
  if (action === 'reset-price' && target.dataset.model) {
    await guard(async () => {
      await client.request(`/admin/prices/${encodeURIComponent(target.dataset.model)}`, { method: 'DELETE' });
      state.prices = (await client.request('/admin/prices')).data || [];
    });
    return;
  }
  if (action === 'refresh-usage') {
    await guard(async () => {
      state.summary = (await client.request('/admin/usage/summary')).data || [];
    });
  }
});

app.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const data = new FormData(form);
  const kind = form.dataset.form;
  if (kind === 'login') {
    client.setToken(String(data.get('token') || '').trim());
    void guard(async () => {
      await loadCustomers();
      state.authed = true;
      state.view = 'customers';
      state.error = '';
    });
    return;
  }
  if (kind === 'create-customer') {
    const credits = Number(data.get('credits') || 0);
    void guard(async () => {
      await client.request('/admin/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: String(data.get('name') || '').trim(),
          email: String(data.get('email') || '').trim() || undefined,
          initial_credits: Number.isInteger(credits) ? credits : 0,
        }),
      });
      await loadCustomers();
      state.view = 'customers';
    });
    return;
  }
  if (kind === 'credit' && state.customer) {
    void guard(async () => {
      await client.request(`/admin/customers/${state.customer.id}/credit`, {
        method: 'POST',
        body: JSON.stringify({
          credits: Number(data.get('credits')),
          note: String(data.get('note') || '') || undefined,
        }),
      });
      await openCustomer(state.customer.id, true);
    });
    return;
  }
  if (kind === 'issue' && state.customer) {
    void guard(async () => {
      const created = await client.request(`/admin/customers/${state.customer.id}/keys`, {
        method: 'POST',
        body: JSON.stringify({ name: String(data.get('name') || '').trim() || 'default' }),
      });
      state.revealed = created.key || '';
      await openCustomer(state.customer.id, true);
    });
    return;
  }
  if (kind === 'price') {
    void guard(async () => {
      await client.request('/admin/prices', {
        method: 'PUT',
        body: JSON.stringify({
          model: form.dataset.model,
          enabled: data.get('enabled') === 'on',
          input_micros_per_million: Number(data.get('input')),
          output_micros_per_million: Number(data.get('output')),
        }),
      });
      state.prices = (await client.request('/admin/prices')).data || [];
      state.notice = t('save');
    });
  }
});

void boot();

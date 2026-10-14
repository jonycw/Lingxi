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
  sourceLabel,
  statusLabel,
  t,
  theme,
  toolbar,
} from './ui.js';

const client = createClient('lingxi.admin.token');
const NAV = ['dashboard', 'customers', 'keys', 'credits', 'prices', 'usage', 'upstream', 'system'];
const state = {
  health: null,
  authed: false,
  view: 'dashboard',
  customers: [],
  customer: null,
  keys: [],
  prices: [],
  summary: [],
  upstream: null,
  revealed: '',
  error: '',
  notice: '',
  busy: false,
};

const app = document.querySelector('#app');

function render() {
  if (!state.authed) {
    app.innerHTML = `
      <main class="erp-login">
        <section class="card">
          <h2>${esc(t('loginTitle'))}</h2>
          <p class="muted">${esc(t('loginHint'))}</p>
          ${banner(state.error, '')}
          <form data-form="login">
            <label>${esc(t('token'))}
              <input name="token" type="password" autocomplete="off" spellcheck="false" required />
            </label>
            <button class="button" type="submit">${esc(t('signIn'))}</button>
          </form>
        </section>
      </main>`;
    return;
  }
  app.innerHTML = `
    <div class="erp">
      <aside class="erp-side">
        <a class="erp-brand" href="/">灵犀<small>管理台</small></a>
        <nav class="erp-nav">
          ${NAV.map((view) => {
            const current = state.view === view || (view === 'customers' && state.view === 'customer');
            const label = view === 'credits' ? t('navCredits') : t(view);
            return `<button type="button" data-action="nav" data-view="${view}" ${current ? 'aria-current="page"' : ''}>${esc(label)}</button>`;
          }).join('')}
        </nav>
      </aside>
      <section class="erp-main">
        ${toolbar({ signedIn: true })}
        <div class="erp-content">
          ${banner(state.error, state.notice)}
          ${body()}
        </div>
      </section>
    </div>`;
}

function body() {
  if (state.view === 'dashboard') return dashboardView();
  if (state.view === 'customers') return customersView();
  if (state.view === 'customer') return customerView();
  if (state.view === 'keys') return keysView();
  if (state.view === 'credits') return creditsView();
  if (state.view === 'prices') return pricesView();
  if (state.view === 'usage') return usageView();
  if (state.view === 'upstream') return upstreamView();
  return systemView();
}

function modeText(upstream) {
  if (!upstream) return '';
  return upstream.mode === 'proxy' ? t('proxy') : t('mock');
}

function dashboardView() {
  const upstream = state.upstream;
  const requests = state.summary.reduce((sum, row) => sum + Number(row.requests || 0), 0);
  const rows = state.summary
    .slice(0, 8)
    .map(
      (row) => `<tr>
        <td><code>${esc(row.key_prefix)}</code></td>
        <td><code>${esc(row.model)}</code></td>
        <td class="num">${esc(row.requests)}</td>
        <td class="num">${esc(row.total_tokens)}</td>
      </tr>`,
    )
    .join('');
  return `
    <section class="stats">
      <div class="stat"><span>${esc(t('dashboardCustomers'))}</span><b>${esc(state.customers.length)}</b></div>
      <div class="stat"><span>${esc(t('dashboardKeys'))}</span><b>${esc(state.keys.length)}</b></div>
      <div class="stat"><span>${esc(t('dashboardRequests'))}</span><b>${esc(requests)}</b></div>
      <div class="stat"><span>${esc(t('effectiveMode'))}</span><b>${esc(modeText(upstream))}</b></div>
    </section>
    ${upstream && !upstream.mock && !upstream.key_set ? `<p class="banner">${esc(t('noKeyHint'))}</p>` : ''}
    <section class="card">
      <h2>${esc(t('usage'))}</h2>
      ${
        rows
          ? `<div class="table-wrap"><table>
              <thead><tr><th>${esc(t('keyPrefix'))}</th><th>${esc(t('model'))}</th><th class="num">${esc(t('requests'))}</th><th class="num">${esc(t('tokens'))}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          : `<p class="muted">${esc(t('emptyUsage'))}</p>`
      }
    </section>`;
}

function customersView() {
  const rows = state.customers
    .map(
      (customer) => `<tr>
        <td><button class="row-link" type="button" data-action="open" data-id="${esc(customer.id)}">${esc(customer.name)}</button></td>
        <td>${esc(customer.email || '—')}</td>
        <td>${badge(customer.status)}</td>
        <td class="num">${esc(customer.balance_credits)}</td>
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
          <button class="button" type="submit">${esc(t('create'))}</button>
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
        <div class="stat"><span>${esc(t('balance'))}</span><b>${esc(customer.balance_credits)}</b></div>
        <div class="stat"><span>${esc(t('status'))}</span><b>${esc(statusLabel(customer.status))}</b></div>
      </div>
      <p><button class="button button-ghost" type="button" data-action="status" data-status="${nextStatus}">${esc(nextStatus === 'active' ? t('activate') : t('suspend'))}</button></p>
      ${revealBox()}
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
      <h2>${esc(t('keys'))}</h2>
      ${
        keys
          ? `<div class="table-wrap"><table><thead><tr><th>${esc(t('name'))}</th><th>${esc(t('prefix'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead><tbody>${keys}</tbody></table></div>`
          : `<p class="muted">${esc(t('emptyKeys'))}</p>`
      }
    </section>`;
}

function revealBox() {
  if (!state.revealed) return '';
  return `<div class="banner ok">
    <p>${esc(t('keyOnce'))}</p>
    <div class="secret" id="revealed-key">${esc(state.revealed)}</div>
    <p><button class="button" type="button" data-action="copy">${esc(t('copy'))}</button></p>
  </div>`;
}

function customerOptions() {
  return state.customers
    .map((customer) => `<option value="${esc(customer.id)}">${esc(customer.name)}</option>`)
    .join('');
}

function keysView() {
  const rows = state.keys
    .map(
      (key) => `<tr>
        <td>${esc(key.customer_name)}</td>
        <td>${esc(key.name)}</td>
        <td><code>${esc(key.prefix)}</code></td>
        <td>${badge(key.status)}</td>
        <td>${esc(formatWhen(key.last_used_at))}</td>
        <td>${key.status === 'active' ? `<button class="button button-danger" type="button" data-action="revoke" data-id="${esc(key.id)}">${esc(t('revoke'))}</button>` : ''}</td>
      </tr>`,
    )
    .join('');
  return `
    ${revealBox()}
    <div class="grid-2">
      <section class="card">
        <h2>${esc(t('keys'))}</h2>
        ${
          rows
            ? `<div class="table-wrap"><table>
                <thead><tr><th>${esc(t('customerName'))}</th><th>${esc(t('name'))}</th><th>${esc(t('prefix'))}</th><th>${esc(t('status'))}</th><th>${esc(t('lastUsed'))}</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
              </table></div>`
            : `<p class="muted">${esc(t('emptyKeys'))}</p>`
        }
      </section>
      <section class="card">
        <h2>${esc(t('issueKey'))}</h2>
        <form data-form="issue-any">
          <label>${esc(t('customerName'))}<select name="customer_id" required>${customerOptions()}</select></label>
          <label>${esc(t('keyName'))}<input name="name" maxlength="100" placeholder="laptop" /></label>
          <button class="button" type="submit" ${state.customers.length ? '' : 'disabled'}>${esc(t('issue'))}</button>
        </form>
      </section>
    </div>`;
}

function creditsView() {
  const rows = state.customers
    .map(
      (customer) => `<tr>
        <td>${esc(customer.name)}</td>
        <td>${badge(customer.status)}</td>
        <td class="num">${esc(customer.balance_credits)}</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="grid-2">
      <section class="card">
        <h2>${esc(t('navCredits'))}</h2>
        ${
          rows
            ? `<div class="table-wrap"><table><thead><tr><th>${esc(t('name'))}</th><th>${esc(t('status'))}</th><th class="num">${esc(t('balance'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<p class="muted">${esc(t('emptyCustomers'))}</p>`
        }
      </section>
      <section class="card">
        <h2>${esc(t('creditTitle'))}</h2>
        <form data-form="credit-any">
          <label>${esc(t('customerName'))}<select name="customer_id" required>${customerOptions()}</select></label>
          <label>${esc(t('creditAmount'))}<input name="credits" type="number" min="1" step="1" required /></label>
          <label>${esc(t('note'))}<input name="note" maxlength="500" /></label>
          <button class="button" type="submit" ${state.customers.length ? '' : 'disabled'}>${esc(t('addCredit'))}</button>
        </form>
      </section>
    </div>`;
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

function upstreamView() {
  const upstream = state.upstream;
  if (!upstream) return `<section class="card"><p class="muted">…</p></section>`;
  const models = (upstream.models || [])
    .map(
      (row) => `<tr>
        <td><code>${esc(row.id)}</code></td>
        <td><code>${esc(row.file_upstream)}</code></td>
        <td><input data-upstream-for="${esc(row.id)}" value="${esc(row.upstream)}" maxlength="128" /></td>
      </tr>`,
    )
    .join('');
  const keyLine = upstream.key_set
    ? `${t('maskedKey')} ${upstream.key_last4 || '····'} · ${sourceLabel(upstream.key_source)}`
    : `${t('keyMissing')} · ${sourceLabel(upstream.key_source)}`;
  return `
    <section class="card">
      <h2>${esc(t('upstream'))}</h2>
      <p class="muted">${esc(t('upstreamHint'))}</p>
      <p><strong>${esc(t('effectiveMode'))}</strong> ${esc(modeText(upstream))} · ${esc(keyLine)}</p>
      ${!upstream.mock && !upstream.key_set ? `<p class="banner">${esc(t('noKeyHint'))}</p>` : ''}
      <form data-form="upstream">
        <label>${esc(t('baseUrl'))}<input name="base_url" required value="${esc(upstream.base_url)}" spellcheck="false" /></label>
        <label>${esc(t('upstreamKey'))}
          <input name="api_key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(t('keepKey'))}" />
        </label>
        <label class="check"><input type="checkbox" name="mock" ${upstream.mock ? 'checked' : ''} /> ${esc(t('mockToggle'))}</label>
        <label class="check"><input type="checkbox" name="clear_api_key" /> ${esc(t('clearKey'))}</label>
        <h2>${esc(t('modelMap'))}</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(t('model'))}</th><th>${esc(t('fileUpstream'))}</th><th>${esc(t('liveUpstream'))}</th></tr></thead>
          <tbody>${models}</tbody>
        </table></div>
        <p class="muted">${esc(t('applyNow'))}</p>
        <div class="cluster">
          <button class="button" type="submit">${esc(t('saveUpstream'))}</button>
          <button class="button button-ghost" type="button" data-action="reset-upstream">${esc(t('resetUpstream'))}</button>
        </div>
      </form>
    </section>`;
}

function systemView() {
  const health = state.health || {};
  const upstream = state.upstream;
  return `
    <section class="card">
      <h2>${esc(t('system'))}</h2>
      <p class="muted">${esc(t('envBootstrap'))}</p>
      <p class="muted">${esc(t('systemHint'))}</p>
      <div class="table-wrap"><table>
        <tbody>
          <tr><th>service</th><td>${esc(health.service || '')}</td></tr>
          <tr><th>version</th><td>${esc(health.version || '')}</td></tr>
          <tr><th>database</th><td>${esc(health.database?.dialect || '')} · ${esc(health.database?.status || '')}</td></tr>
          <tr><th>upstream</th><td>${esc(health.upstream || '')}</td></tr>
          <tr><th>${esc(t('baseUrl'))}</th><td><code>${esc(upstream?.base_url || '')}</code> · ${esc(sourceLabel(upstream?.base_url_source))}</td></tr>
          <tr><th>${esc(t('upstreamKey'))}</th><td>${esc(upstream?.key_set ? `${t('maskedKey')} ${upstream.key_last4 || ''}` : t('keyMissing'))}</td></tr>
        </tbody>
      </table></div>
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
  state.customers = (await client.request('/admin/customers?limit=100')).data || [];
}

async function loadKeys() {
  state.keys = (await client.request('/admin/keys?limit=200')).data || [];
}

async function loadPrices() {
  state.prices = (await client.request('/admin/prices')).data || [];
}

async function loadSummary() {
  state.summary = (await client.request('/admin/usage/summary')).data || [];
}

async function loadUpstream() {
  state.upstream = await client.request('/admin/upstream');
  state.health = await loadHealth();
}

async function openCustomer(id, keepReveal) {
  state.customer = await client.request(`/admin/customers/${id}`);
  state.view = 'customer';
  if (!keepReveal) state.revealed = '';
}

async function show(view) {
  state.view = view;
  state.notice = '';
  state.error = '';
  if (view === 'dashboard') {
    await Promise.all([loadCustomers(), loadKeys(), loadSummary(), loadUpstream()]);
  } else if (view === 'customers') {
    await loadCustomers();
  } else if (view === 'keys' || view === 'credits') {
    await Promise.all([loadCustomers(), loadKeys()]);
  } else if (view === 'prices') {
    await loadPrices();
  } else if (view === 'usage') {
    await loadSummary();
  } else if (view === 'upstream' || view === 'system') {
    await loadUpstream();
  }
}

async function boot() {
  state.health = await loadHealth();
  if (!client.token()) {
    render();
    return;
  }
  await guard(async () => {
    await show('dashboard');
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
    await guard(() => show(target.dataset.view || 'dashboard'));
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
      if (state.view === 'customer' && state.customer?.id) await openCustomer(state.customer.id, true);
      else await loadKeys();
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
      await loadPrices();
    });
    return;
  }
  if (action === 'refresh-usage') {
    await guard(loadSummary);
    return;
  }
  if (action === 'reset-upstream') {
    await guard(async () => {
      state.upstream = await client.request('/admin/upstream', {
        method: 'PUT',
        body: JSON.stringify({ reset: true }),
      });
      state.health = await loadHealth();
      state.notice = t('save');
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
      await show('dashboard');
      state.authed = true;
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
      await loadCustomers();
    });
    return;
  }
  if (kind === 'credit-any') {
    const id = String(data.get('customer_id') || '');
    void guard(async () => {
      await client.request(`/admin/customers/${id}/credit`, {
        method: 'POST',
        body: JSON.stringify({
          credits: Number(data.get('credits')),
          note: String(data.get('note') || '') || undefined,
        }),
      });
      await loadCustomers();
      state.notice = t('addCredit');
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
  if (kind === 'issue-any') {
    const id = String(data.get('customer_id') || '');
    void guard(async () => {
      const created = await client.request(`/admin/customers/${id}/keys`, {
        method: 'POST',
        body: JSON.stringify({ name: String(data.get('name') || '').trim() || 'default' }),
      });
      state.revealed = created.key || '';
      await Promise.all([loadKeys(), loadCustomers()]);
      state.view = 'keys';
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
      await loadPrices();
      state.notice = t('save');
    });
    return;
  }
  if (kind === 'upstream') {
    const typed = String(data.get('api_key') || '').trim();
    const clear = data.get('clear_api_key') === 'on';
    const models = [...form.querySelectorAll('[data-upstream-for]')].map((input) => ({
      id: input.dataset.upstreamFor,
      upstream: input.value,
    }));
    const payload = {
      base_url: String(data.get('base_url') || '').trim(),
      mock: data.get('mock') === 'on',
      models,
    };
    if (clear) payload.clear_api_key = true;
    else if (typed) payload.api_key = typed;
    void guard(async () => {
      state.upstream = await client.request('/admin/upstream', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.health = await loadHealth();
      state.notice = t('applyNow');
      state.view = 'upstream';
    });
  }
});

void boot();

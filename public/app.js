// ============================================================================
// SmartDialer — Frontend SPA
// ============================================================================
const API = '/api';
let currentRoute = '/';
let campaignsCache = [];

// --- API helpers ---
async function api(path, options = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err.message.startsWith('HTTP')) throw err;
    throw new Error(`Network error: ${err.message}`);
  }
}

// --- Toast ---
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, 3500);
}

// --- Modal ---
function showModal(title, bodyHtml, footerHtml = '') {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${escapeHtml(title)}</span>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
  `;
  overlay.style.display = 'flex';
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
}

function closeModal() {
  document.getElementById('modalOverlay').style = 'display:none;';
}

// --- Utilities ---
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncate(str, len = 8) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusBadge(status) {
  const map = {
    created: 'neutral', active: 'success', paused: 'warning',
    completed: 'info', cancelled: 'error',
    OFFLINE: 'neutral', AVAILABLE: 'success', RESERVED: 'warning',
    DIALING: 'accent', CONNECTED: 'info', WRAP_UP: 'warning', PAUSED: 'neutral',
    QUEUED: 'neutral', RESERVED: 'warning', INITIATED: 'accent',
    RINGING: 'info', ANSWERED: 'info', COMPLETED: 'success',
    FAILED: 'error', CANCELLED: 'neutral',
    eligible: 'success', allocated: 'warning', completed: 'info',
    exhausted: 'neutral', do_not_call: 'error', invalid_number: 'error',
    HEALTHY: 'success', DEGRADED: 'warning', UNHEALTHY: 'error',
  };
  const cls = map[status] || 'neutral';
  return `<span class="badge badge--${cls}">${escapeHtml(status)}</span>`;
}

function showLoading(msg = 'Loading...') {
  return `<div class="loading-state"><div class="spinner"></div><p>${escapeHtml(msg)}</p></div>`;
}

function emptyState(title, text) {
  return `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      <div class="empty-state-text">${escapeHtml(text)}</div>
    </div>
  `;
}

function renderTable(headers, rows, options = {}) {
  if (!rows || rows.length === 0) {
    return emptyState(options.emptyTitle || 'No data found', options.emptyText || 'There are no records to display.');
  }
  return `
    <div class="table-wrapper">
      <table>
        <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

// --- Router ---
function navigate(route) {
  currentRoute = route;
  closeModal();
  updateNavActive();
  updateBreadcrumb(route);
  renderPage(route);
}

function updateNavActive() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === currentRoute);
  });
}

function updateBreadcrumb(route) {
  const names = {
    '/': 'Dashboard',
    '/campaigns': 'Campaigns',
    '/agents': 'Agents',
    '/borrowers': 'Borrowers',
    '/calls': 'Calls',
    '/dialer': 'Dialer Control',
    '/simulation': 'Simulation',
    '/providers': 'Provider Health',
    '/recovery': 'Recovery',
    '/settings': 'Settings',
  };
  let parts = route.split('/').filter(Boolean);
  let label = names[route] || names[`/${parts[0] || ''}`] || 'Dashboard';
  if (route.includes('/campaigns/') && parts[1]) {
    label = `Campaigns / ${parts[1]}`;
  }
  document.getElementById('breadcrumb').textContent = label;
}

async function renderPage(route) {
  const content = document.getElementById('pageContent');
  content.innerHTML = showLoading();

  try {
    if (route === '/') await renderDashboard(content);
    else if (route === '/campaigns') await renderCampaigns(content);
    else if (route.startsWith('/campaigns/')) await renderCampaignDetail(content, route.split('/')[2]);
    else if (route === '/agents') await renderAgents(content);
    else if (route === '/borrowers') await renderBorrowers(content);
    else if (route === '/calls') await renderCalls(content);
    else if (route === '/dialer') await renderDialer(content);
    else if (route === '/simulation') await renderSimulation(content);
    else if (route === '/providers') await renderProviders(content);
    else if (route === '/recovery') await renderRecovery(content);
    else if (route === '/settings') await renderSettings(content);
    else await renderDashboard(content);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error loading page</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
  }
}

// ============================================================================
// DASHBOARD
// ============================================================================
async function renderDashboard(container) {
  let campaigns = [];
  try {
    campaigns = await api('/campaigns');
    campaignsCache = campaigns;
  } catch {}

  let totalAgents = 0, totalBorrowers = 0, totalCalls = 0;
  let activeCampaigns = 0, completedCampaigns = 0;
  let totalCompleted = 0, totalFailed = 0;

  for (const c of campaigns) {
    if (c.status === 'active') activeCampaigns++;
    if (c.status === 'completed') completedCampaigns++;
    try {
      const m = await api(`/campaigns/${c.id}/metrics`);
      totalAgents += m.agents.total;
      totalBorrowers += m.borrowers.total;
      totalCalls += m.calls.total;
      totalCompleted += m.calls.completed;
      totalFailed += m.calls.failed;
    } catch {}
  }

  let providers = [];
  try { providers = await api('/providers/health'); } catch {}

  container.innerHTML = `
    <div class="page-title">Dashboard</div>
    <div class="page-description">Overview of all campaigns, agents, borrowers, and system health.</div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Total Campaigns</div>
        <div class="stat-value">${campaigns.length}</div>
        <div class="stat-sub">${activeCampaigns} active · ${completedCampaigns} completed</div>
      </div>
      <div class="stat-card stat-card--accent">
        <div class="stat-label">Total Agents</div>
        <div class="stat-value">${totalAgents}</div>
        <div class="stat-sub">Across all campaigns</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Borrowers</div>
        <div class="stat-value">${totalBorrowers}</div>
        <div class="stat-sub">Phone numbers to dial</div>
      </div>
      <div class="stat-card stat-card--success">
        <div class="stat-label">Completed Calls</div>
        <div class="stat-value">${totalCompleted}</div>
        <div class="stat-sub">${totalCalls} total calls placed</div>
      </div>
      <div class="stat-card stat-card--error">
        <div class="stat-label">Failed Calls</div>
        <div class="stat-value">${totalFailed}</div>
        <div class="stat-sub">Includes timeouts</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Providers</div>
        <div class="stat-value">${providers.length}</div>
        <div class="stat-sub">${providers.filter(p => p.healthStatus === 'HEALTHY').length} healthy</div>
      </div>
    </div>

    <div class="flex gap-16" style="flex-direction:column;">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Campaigns</span>
          <button class="btn btn--sm" onclick="navigate('/campaigns')">View All</button>
        </div>
        <div class="card-body" style="padding:0;">
          ${renderTable(
            ['Name', 'Mode', 'Status', 'Created'],
            campaigns.slice(0, 5).map(c => `
              <tr style="cursor:pointer;" onclick="navigate('/campaigns/${c.id}')">
                <td style="font-weight:600;">${escapeHtml(c.name)}</td>
                <td><span class="badge badge--accent">${escapeHtml(c.mode)}</span></td>
                <td>${statusBadge(c.status)}</td>
                <td class="text-muted text-sm">${formatTime(c.createdAt)}</td>
              </tr>
            `),
            { emptyTitle: 'No campaigns yet', emptyText: 'Create a campaign to get started.' }
          )}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Provider Health</span>
          <button class="btn btn--sm" onclick="navigate('/providers')">Details</button>
        </div>
        <div class="card-body" style="padding:0;">
          ${renderTable(
            ['Provider', 'Status', 'Total Calls', 'Success', 'Failures', 'Consecutive Failures'],
            providers.map(p => `
              <tr>
                <td style="font-weight:600;">${escapeHtml(p.providerName)}</td>
                <td>${statusBadge(p.healthStatus)}</td>
                <td>${p.totalCalls}</td>
                <td>${p.successfulCalls}</td>
                <td>${p.failedCalls + p.timedOutCalls}</td>
                <td>${p.consecutiveFailures}</td>
              </tr>
            `),
            { emptyTitle: 'No provider data', emptyText: 'Provider health will appear after calls are made.' }
          )}
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// CAMPAIGNS
// ============================================================================
async function renderCampaigns(container) {
  const campaigns = await api('/campaigns');
  campaignsCache = campaigns;

  container.innerHTML = `
    <div class="flex-between mb-24">
      <div>
        <div class="page-title">Campaigns</div>
        <div class="page-description">Manage dialing campaigns with progressive or predictive pacing.</div>
      </div>
      <button class="btn btn--primary" onclick="showCreateCampaignModal()">
        + New Campaign
      </button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Total Campaigns</div>
        <div class="stat-value">${campaigns.length}</div>
      </div>
      <div class="stat-card stat-card--success">
        <div class="stat-label">Active</div>
        <div class="stat-value">${campaigns.filter(c => c.status === 'active').length}</div>
      </div>
      <div class="stat-card stat-card--warning">
        <div class="stat-label">Paused</div>
        <div class="stat-value">${campaigns.filter(c => c.status === 'paused').length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Completed</div>
        <div class="stat-value">${campaigns.filter(c => c.status === 'completed').length}</div>
      </div>
    </div>

    <div class="table-wrapper">
      ${renderTable(
        ['Name', 'Mode', 'Status', 'Created', 'Actions'],
        campaigns.map(c => `
          <tr style="cursor:pointer;" onclick="navigate('/campaigns/${c.id}')">
            <td style="font-weight:600;">${escapeHtml(c.name)}</td>
            <td><span class="badge badge--accent">${escapeHtml(c.mode)}</span></td>
            <td>${statusBadge(c.status)}</td>
            <td class="text-muted text-sm">${formatTime(c.createdAt)}</td>
            <td onclick="event.stopPropagation()">
              <select class="form-select" style="width:auto;padding:4px 8px;font-size:12px;" onchange="updateCampaignStatus('${c.id}', this.value)">
                <option value="" ${c.status ? '' : 'selected'} disabled>Change status...</option>
                ${['created','active','paused','completed','cancelled'].map(s =>
                  `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`
                ).join('')}
              </select>
            </td>
          </tr>
        `),
        { emptyTitle: 'No campaigns yet', emptyText: 'Create a campaign to start dialing.' }
      )}
    </div>
  `;
}

function showCreateCampaignModal() {
  showModal(
    'Create New Campaign',
    `
      <form id="createCampaignForm" onsubmit="createCampaign(event)">
        <div class="form-group">
          <label class="form-label">Campaign Name</label>
          <input class="form-input" name="name" placeholder="e.g. Q4 Collections" required />
        </div>
        <div class="form-group">
          <label class="form-label">Dialing Mode</label>
          <select class="form-select" name="mode" required>
            <option value="progressive">Progressive (1:1 — safe, no overdial)</option>
            <option value="predictive">Predictive (overdial for agent efficiency)</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Target Abandonment Rate</label>
            <input class="form-input" type="number" step="0.01" name="targetAbandonmentRate" placeholder="0.03" />
          </div>
          <div class="form-group">
            <label class="form-label">Max Concurrent Calls</label>
            <input class="form-input" type="number" name="maxConcurrency" placeholder="500" />
          </div>
        </div>
        <div class="modal-footer" style="padding:0;border:none;margin-top:8px;">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn--primary">Create Campaign</button>
        </div>
      </form>
    `
  );
}

async function createCampaign(event) {
  event.preventDefault();
  const form = event.target;
  const body = {
    name: form.name.value,
    mode: form.mode.value,
  };
  const target = form.targetAbandonmentRate.value;
  const max = form.maxConcurrency.value;
  if (target) body.targetAbandonmentRate = parseFloat(target);
  if (max) body.maxConcurrency = parseInt(max);

  try {
    await api('/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    closeModal();
    toast('Campaign created successfully', 'success');
    renderPage('/campaigns');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function updateCampaignStatus(id, status) {
  if (!status) return;
  try {
    await api(`/campaigns/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    toast(`Campaign status updated to "${status}"`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ============================================================================
// CAMPAIGN DETAIL
// ============================================================================
async function renderCampaignDetail(container, campaignId) {
  const campaign = await api(`/campaigns/${campaignId}`);
  let metrics = {};
  try { metrics = await api(`/campaigns/${campaignId}/metrics`); } catch {}

  let agents = [];
  try { agents = await api(`/campaigns/${campaignId}/agents`); } catch {}

  let borrowers = [];
  try { borrowers = await api(`/campaigns/${campaignId}/borrowers`); } catch {}

  let calls = [];
  try { calls = await api(`/campaigns/${campaignId}/calls`); } catch {}

  let config = {};
  try { config = JSON.parse(campaign.configJson || '{}'); } catch {}

  container.innerHTML = `
    <div class="flex-between mb-24">
      <div>
        <div class="page-title">${escapeHtml(campaign.name)}</div>
        <div class="page-description">Campaign overview and management</div>
      </div>
      <div class="flex gap-8">
        <button class="btn" onclick="navigate('/campaigns')">← Back</button>
        <button class="btn btn--primary" onclick="triggerTick('${campaignId}', '${campaign.mode}')">Run Tick</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Status</div>
        <div class="stat-value" style="font-size:20px;">${statusBadge(campaign.status)}</div>
      </div>
      <div class="stat-card stat-card--accent">
        <div class="stat-label">Mode</div>
        <div class="stat-value" style="font-size:20px;">${escapeHtml(campaign.mode)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Agents</div>
        <div class="stat-value">${metrics.agents?.total ?? agents.length}</div>
        <div class="stat-sub">${metrics.agents?.breakdown ? Object.entries(metrics.agents.breakdown).filter(([_,v]) => v > 0).map(([k,v]) => `${k}: ${v}`).join(', ') : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Borrowers</div>
        <div class="stat-value">${metrics.borrowers?.total ?? borrowers.length}</div>
        <div class="stat-sub">${metrics.borrowers?.eligible ?? 0} eligible</div>
      </div>
      <div class="stat-card stat-card--success">
        <div class="stat-label">Completed Calls</div>
        <div class="stat-value">${metrics.calls?.completed ?? 0}</div>
      </div>
      <div class="stat-card stat-card--error">
        <div class="stat-label">Failed Calls</div>
        <div class="stat-value">${metrics.calls?.failed ?? 0}</div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="switchTab(event, 'tab-agents')">Agents (${agents.length})</button>
      <button class="tab" onclick="switchTab(event, 'tab-borrowers')">Borrowers (${borrowers.length})</button>
      <button class="tab" onclick="switchTab(event, 'tab-calls')">Calls (${calls.length})</button>
      <button class="tab" onclick="switchTab(event, 'tab-config')">Config</button>
    </div>

    <div id="tab-agents" class="tab-content">
      <div class="flex-between mb-16">
        <div></div>
        <button class="btn btn--sm" onclick="showAddAgentModal('${campaignId}')">+ Add Agents</button>
      </div>
      ${renderTable(
        ['ID', 'State', 'Version', 'Reserved At', 'Last Heartbeat', 'Actions'],
        agents.slice(0, 50).map(a => `
          <tr>
            <td class="text-mono text-sm">${truncate(a.id)}</td>
            <td>${statusBadge(a.state)}</td>
            <td>${a.version}</td>
            <td class="text-sm">${formatTime(a.reservedAt)}</td>
            <td class="text-sm">${formatTime(a.lastHeartbeatAt)}</td>
            <td>
              <button class="btn btn--sm" onclick="showAgentTransitionModal('${a.id}', '${a.state}', '${a.version}')">Change State</button>
              <button class="btn btn--sm" onclick="sendHeartbeat('${a.id}')">Heartbeat</button>
            </td>
          </tr>
        `),
        { emptyTitle: 'No agents', emptyText: 'Add agents to this campaign.' }
      )}
    </div>

    <div id="tab-borrowers" class="tab-content" style="display:none;">
      <div class="flex-between mb-16">
        <select class="form-select" style="width:auto;" id="borrowerFilter" onchange="filterBorrowers('${campaignId}')">
          <option value="">All Statuses</option>
          ${['eligible','allocated','completed','exhausted','do_not_call','invalid_number'].map(s =>
            `<option value="${s}">${s}</option>`
          ).join('')}
        </select>
        <button class="btn btn--sm" onclick="showAddBorrowerModal('${campaignId}')">+ Add Borrower</button>
      </div>
      <div id="borrowersTable">
        ${renderTable(
          ['Phone Number', 'Status', 'Priority', 'Attempts', 'Last Attempt', 'Next Eligible'],
          borrowers.slice(0, 50).map(b => `
            <tr>
              <td class="text-mono">${escapeHtml(b.phoneNumber)}</td>
              <td>${statusBadge(b.status)}</td>
              <td>${b.priority}</td>
              <td>${b.attemptCount}</td>
              <td class="text-sm">${formatTime(b.lastAttemptAt)}</td>
              <td class="text-sm">${formatTime(b.nextEligibleAt)}</td>
            </tr>
          `),
          { emptyTitle: 'No borrowers', emptyText: 'Add borrowers to dial.' }
        )}
      </div>
    </div>

    <div id="tab-calls" class="tab-content" style="display:none;">
      ${renderTable(
        ['Call ID', 'State', 'Agent', 'Borrower', 'Attempt', 'Provider Call ID', 'Created', 'Failure Reason'],
        calls.slice(-100).reverse().map(c => `
          <tr>
            <td class="text-mono text-sm">${truncate(c.id)}</td>
            <td>${statusBadge(c.state)}</td>
            <td class="text-mono text-sm">${truncate(c.agentId)}</td>
            <td class="text-mono text-sm">${truncate(c.borrowerId)}</td>
            <td>${c.attemptNumber}</td>
            <td class="text-mono text-sm">${truncate(c.providerCallId)}</td>
            <td class="text-sm">${formatTime(c.createdAt)}</td>
            <td class="text-sm text-muted">${escapeHtml(c.failureReason || '')}</td>
          </tr>
        `),
        { emptyTitle: 'No calls yet', emptyText: 'Run a dialer tick to place calls.' }
      )}
    </div>

    <div id="tab-config" class="tab-content" style="display:none;">
      <div class="card">
        <div class="card-header"><span class="card-title">Campaign Configuration</span></div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Campaign ID</div><div class="detail-value">${escapeHtml(campaign.id)}</div></div>
            <div class="detail-item"><div class="detail-label">Created At</div><div class="detail-value">${formatTime(campaign.createdAt)}</div></div>
            <div class="detail-item"><div class="detail-label">Updated At</div><div class="detail-value">${formatTime(campaign.updatedAt)}</div></div>
            <div class="detail-item"><div class="detail-label">Mode</div><div class="detail-value">${escapeHtml(campaign.mode)}</div></div>
            ${Object.entries(config).map(([k, v]) => `
              <div class="detail-item"><div class="detail-label">${escapeHtml(k)}</div><div class="detail-value">${escapeHtml(String(v))}</div></div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function switchTab(event, tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.getElementById(tabId).style.display = 'block';
}

async function filterBorrowers(campaignId) {
  const select = document.getElementById('borrowerFilter');
  const status = select.value;
  const borrowers = await api(`/campaigns/${campaignId}/borrowers${status ? `?status=${status}` : ''}`);
  document.getElementById('borrowersTable').innerHTML = renderTable(
    ['Phone Number', 'Status', 'Priority', 'Attempts', 'Last Attempt', 'Next Eligible'],
    borrowers.slice(0, 50).map(b => `
      <tr>
        <td class="text-mono">${escapeHtml(b.phoneNumber)}</td>
        <td>${statusBadge(b.status)}</td>
        <td>${b.priority}</td>
        <td>${b.attemptCount}</td>
        <td class="text-sm">${formatTime(b.lastAttemptAt)}</td>
        <td class="text-sm">${formatTime(b.nextEligibleAt)}</td>
      </tr>
    `),
    { emptyTitle: 'No borrowers', emptyText: 'No borrowers match this filter.' }
  );
}

// ============================================================================
// AGENTS PAGE
// ============================================================================
async function renderAgents(container) {
  const campaigns = await api('/campaigns');
  campaignsCache = campaigns;

  if (campaigns.length === 0) {
    container.innerHTML = `
      <div class="page-title">Agents</div>
      <div class="page-description">Manage agents across your campaigns.</div>
      ${emptyState('No campaigns', 'Create a campaign first to add agents.')}
    `;
    return;
  }

  let allAgents = [];
  for (const c of campaigns) {
    try {
      const agents = await api(`/campaigns/${c.id}/agents`);
      allAgents.push(...agents.map(a => ({ ...a, campaignName: c.name, campaignId: c.id })));
    } catch {}
  }

  const stateCounts = {};
  for (const a of allAgents) {
    stateCounts[a.state] = (stateCounts[a.state] || 0) + 1;
  }

  container.innerHTML = `
    <div class="flex-between mb-24">
      <div>
        <div class="page-title">Agents</div>
        <div class="page-description">All agents across campaigns. Select a campaign to add or manage agents.</div>
      </div>
      <select class="form-select" style="width:auto;" id="agentCampaignSelect" onchange="showAddAgentModal(this.value)">
        <option value="">+ Add Agents to...</option>
        ${campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total Agents</div><div class="stat-value">${allAgents.length}</div></div>
      <div class="stat-card stat-card--success"><div class="stat-label">Available</div><div class="stat-value">${stateCounts['AVAILABLE'] || 0}</div></div>
      <div class="stat-card stat-card--warning"><div class="stat-label">Busy</div><div class="stat-value">${(stateCounts['RESERVED']||0)+(stateCounts['DIALING']||0)+(stateCounts['CONNECTED']||0)+(stateCounts['WRAP_UP']||0)}</div></div>
      <div class="stat-card"><div class="stat-label">Offline</div><div class="stat-value">${stateCounts['OFFLINE'] || 0}</div></div>
    </div>

    <div class="table-wrapper">
      ${renderTable(
        ['ID', 'Campaign', 'State', 'Version', 'Reserved At', 'Heartbeat', 'Actions'],
        allAgents.slice(0, 100).map(a => `
          <tr>
            <td class="text-mono text-sm">${truncate(a.id)}</td>
            <td>${escapeHtml(a.campaignName)}</td>
            <td>${statusBadge(a.state)}</td>
            <td>${a.version}</td>
            <td class="text-sm">${formatTime(a.reservedAt)}</td>
            <td class="text-sm">${formatTime(a.lastHeartbeatAt)}</td>
            <td>
              <button class="btn btn--sm" onclick="showAgentTransitionModal('${a.id}', '${a.state}', '${a.version}')">Change State</button>
              <button class="btn btn--sm" onclick="sendHeartbeat('${a.id}')">Heartbeat</button>
            </td>
          </tr>
        `),
        { emptyTitle: 'No agents', emptyText: 'Add agents to a campaign.' }
      )}
    </div>
  `;
}

function showAddAgentModal(campaignId) {
  if (!campaignId) return;
  showModal(
    'Add Agents',
    `
      <form onsubmit="addAgents(event, '${campaignId}')">
        <div class="form-group">
          <label class="form-label">Initial State</label>
          <select class="form-select" name="state">
            <option value="AVAILABLE">Available</option>
            <option value="OFFLINE">Offline</option>
            <option value="PAUSED">Paused</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Count</label>
          <input class="form-input" type="number" name="count" value="1" min="1" max="100" />
          <div class="form-hint">Create multiple agents at once (batch).</div>
        </div>
        <div class="modal-footer" style="padding:0;border:none;margin-top:8px;">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn--primary">Add Agents</button>
        </div>
      </form>
    `
  );
}

async function addAgents(event, campaignId) {
  event.preventDefault();
  const form = event.target;
  const state = form.state.value;
  const count = parseInt(form.count.value);
  try {
    const result = await api(`/campaigns/${campaignId}/agents`, {
      method: 'POST',
      body: JSON.stringify({ state, count }),
    });
    closeModal();
    toast(`${result.createdCount} agent(s) added`, 'success');
    renderPage(currentRoute);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showAgentTransitionModal(agentId, currentState, version) {
  const validTargets = {
    OFFLINE: ['AVAILABLE'],
    AVAILABLE: ['RESERVED', 'PAUSED', 'OFFLINE'],
    RESERVED: ['DIALING', 'AVAILABLE', 'OFFLINE'],
    DIALING: ['CONNECTED', 'AVAILABLE', 'OFFLINE'],
    CONNECTED: ['WRAP_UP', 'OFFLINE'],
    WRAP_UP: ['AVAILABLE', 'OFFLINE'],
    PAUSED: ['AVAILABLE', 'OFFLINE'],
  };
  const targets = validTargets[currentState] || [];

  showModal(
    'Change Agent State',
    `
      <div class="detail-item mb-16">
        <div class="detail-label">Current State</div>
        <div class="detail-value">${statusBadge(currentState)}</div>
      </div>
      <form onsubmit="transitionAgent(event, '${agentId}')">
        <div class="form-group">
          <label class="form-label">Target State</label>
          <select class="form-select" name="targetState" required>
            ${targets.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
          <div class="form-hint">Only valid transitions are shown. The state machine enforces these rules.</div>
        </div>
        <div class="modal-footer" style="padding:0;border:none;margin-top:8px;">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn--primary">Transition</button>
        </div>
      </form>
    `
  );
}

async function transitionAgent(event, agentId) {
  event.preventDefault();
  const form = event.target;
  const targetState = form.targetState.value;
  try {
    await api(`/agents/${agentId}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ targetState }),
    });
    closeModal();
    toast(`Agent state changed to ${targetState}`, 'success');
    renderPage(currentRoute);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function sendHeartbeat(agentId) {
  try {
    await api(`/agents/${agentId}/heartbeat`, { method: 'POST' });
    toast('Heartbeat recorded', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ============================================================================
// BORROWERS PAGE
// ============================================================================
async function renderBorrowers(container) {
  const campaigns = await api('/campaigns');
  campaignsCache = campaigns;

  if (campaigns.length === 0) {
    container.innerHTML = `
      <div class="page-title">Borrowers</div>
      <div class="page-description">Phone numbers to dial across campaigns.</div>
      ${emptyState('No campaigns', 'Create a campaign first to add borrowers.')}
    `;
    return;
  }

  let allBorrowers = [];
  for (const c of campaigns) {
    try {
      const borrowers = await api(`/campaigns/${c.id}/borrowers`);
      allBorrowers.push(...borrowers.map(b => ({ ...b, campaignName: c.name, campaignId: c.id })));
    } catch {}
  }

  const statusCounts = {};
  for (const b of allBorrowers) {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  }

  container.innerHTML = `
    <div class="flex-between mb-24">
      <div>
        <div class="page-title">Borrowers</div>
        <div class="page-description">Phone numbers queued for dialing across all campaigns.</div>
      </div>
      <select class="form-select" style="width:auto;" id="borrowerCampaignSelect" onchange="showAddBorrowerModal(this.value)">
        <option value="">+ Add Borrower to...</option>
        ${campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total Borrowers</div><div class="stat-value">${allBorrowers.length}</div></div>
      <div class="stat-card stat-card--success"><div class="stat-label">Eligible</div><div class="stat-value">${statusCounts['eligible'] || 0}</div></div>
      <div class="stat-card stat-card--warning"><div class="stat-label">Allocated</div><div class="stat-value">${statusCounts['allocated'] || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value">${statusCounts['completed'] || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Exhausted</div><div class="stat-value">${statusCounts['exhausted'] || 0}</div></div>
    </div>

    <div class="table-wrapper">
      ${renderTable(
        ['Phone Number', 'Campaign', 'Status', 'Priority', 'Attempts', 'Last Attempt', 'Next Eligible'],
        allBorrowers.slice(0, 100).map(b => `
          <tr>
            <td class="text-mono">${escapeHtml(b.phoneNumber)}</td>
            <td>${escapeHtml(b.campaignName)}</td>
            <td>${statusBadge(b.status)}</td>
            <td>${b.priority}</td>
            <td>${b.attemptCount}</td>
            <td class="text-sm">${formatTime(b.lastAttemptAt)}</td>
            <td class="text-sm">${formatTime(b.nextEligibleAt)}</td>
          </tr>
        `),
        { emptyTitle: 'No borrowers', emptyText: 'Add borrowers to a campaign.' }
      )}
    </div>
  `;
}

function showAddBorrowerModal(campaignId) {
  if (!campaignId) return;
  showModal(
    'Add Borrower',
    `
      <form onsubmit="addBorrower(event, '${campaignId}')">
        <div class="form-group">
          <label class="form-label">Phone Number</label>
          <input class="form-input" name="phoneNumber" placeholder="e.g. 555-1234567" required />
        </div>
        <div class="form-group">
          <label class="form-label">Priority (0-10, higher = more urgent)</label>
          <input class="form-input" type="number" name="priority" value="0" min="0" max="10" />
        </div>
        <div class="modal-footer" style="padding:0;border:none;margin-top:8px;">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn--primary">Add Borrower</button>
        </div>
      </form>
    `
  );
}

async function addBorrower(event, campaignId) {
  event.preventDefault();
  const form = event.target;
  try {
    await api(`/campaigns/${campaignId}/borrowers`, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumber: form.phoneNumber.value,
        priority: parseInt(form.priority.value),
      }),
    });
    closeModal();
    toast('Borrower added', 'success');
    renderPage(currentRoute);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ============================================================================
// CALLS PAGE
// ============================================================================
async function renderCalls(container) {
  const campaigns = await api('/campaigns');
  campaignsCache = campaigns;

  if (campaigns.length === 0) {
    container.innerHTML = `
      <div class="page-title">Calls</div>
      <div class="page-description">All calls placed across campaigns.</div>
      ${emptyState('No campaigns', 'Create a campaign and run the dialer to see calls.')}
    `;
    return;
  }

  let allCalls = [];
  for (const c of campaigns) {
    try {
      const calls = await api(`/campaigns/${c.id}/calls`);
      allCalls.push(...calls.map(call => ({ ...call, campaignName: c.name })));
    } catch {}
  }

  allCalls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const stateCounts = {};
  for (const c of allCalls) {
    stateCounts[c.state] = (stateCounts[c.state] || 0) + 1;
  }

  container.innerHTML = `
    <div class="page-title">Calls</div>
    <div class="page-description">All calls placed by the dialer across all campaigns.</div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total Calls</div><div class="stat-value">${allCalls.length}</div></div>
      <div class="stat-card stat-card--success"><div class="stat-label">Completed</div><div class="stat-value">${stateCounts['COMPLETED'] || 0}</div></div>
      <div class="stat-card stat-card--error"><div class="stat-label">Failed</div><div class="stat-value">${stateCounts['FAILED'] || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Cancelled</div><div class="stat-value">${stateCounts['CANCELLED'] || 0}</div></div>
      <div class="stat-card stat-card--warning"><div class="stat-label">Active</div><div class="stat-value">${(stateCounts['QUEUED']||0)+(stateCounts['RESERVED']||0)+(stateCounts['INITIATED']||0)+(stateCounts['RINGING']||0)+(stateCounts['ANSWERED']||0)+(stateCounts['CONNECTED']||0)}</div></div>
    </div>

    <div class="table-wrapper">
      ${renderTable(
        ['Call ID', 'Campaign', 'State', 'Agent', 'Borrower', 'Attempt', 'Provider', 'Created', 'Failure Reason'],
        allCalls.slice(0, 200).map(c => `
          <tr>
            <td class="text-mono text-sm">${truncate(c.id)}</td>
            <td>${escapeHtml(c.campaignName)}</td>
            <td>${statusBadge(c.state)}</td>
            <td class="text-mono text-sm">${truncate(c.agentId)}</td>
            <td class="text-mono text-sm">${truncate(c.borrowerId)}</td>
            <td>${c.attemptNumber}</td>
            <td class="text-sm">${escapeHtml(c.providerName || '—')}</td>
            <td class="text-sm">${formatTime(c.createdAt)}</td>
            <td class="text-sm text-muted">${escapeHtml(c.failureReason || '')}</td>
          </tr>
        `),
        { emptyTitle: 'No calls yet', emptyText: 'Run the dialer to place calls.' }
      )}
    </div>
  `;
}

// ============================================================================
// DIALER CONTROL PAGE
// ============================================================================
async function renderDialer(container) {
  const campaigns = await api('/campaigns');
  campaignsCache = campaigns;

  container.innerHTML = `
    <div class="page-title">Dialer Control</div>
    <div class="page-description">Manually trigger dialer ticks and process provider events.</div>

    ${campaigns.length === 0 ? emptyState('No campaigns', 'Create a campaign first.') : `
      <div class="card mb-24">
        <div class="card-header"><span class="card-title">Trigger Dialer Tick</span></div>
        <div class="card-body">
          <form onsubmit="triggerTickForm(event)">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Campaign</label>
                <select class="form-select" name="campaignId" required>
                  ${campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.mode})</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Mode Override</label>
                <select class="form-select" name="mode">
                  <option value="">Use campaign default</option>
                  <option value="progressive">Progressive</option>
                  <option value="predictive">Predictive</option>
                </select>
              </div>
            </div>
            <button type="submit" class="btn btn--primary">Run Tick</button>
          </form>
        </div>
      </div>

      <div class="card mb-24">
        <div class="card-header"><span class="card-title">Process Provider Event</span></div>
        <div class="card-body">
          <form onsubmit="processEventForm(event)">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Event ID</label>
                <input class="form-input" name="eventId" placeholder="e.g. evt-001" required />
              </div>
              <div class="form-group">
                <label class="form-label">Provider Call ID</label>
                <input class="form-input" name="providerCallId" placeholder="Provider's call ID" required />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Event Type</label>
                <select class="form-select" name="eventType" required>
                  <option value="RINGING">RINGING</option>
                  <option value="ANSWERED">ANSWERED</option>
                  <option value="CONNECTED">CONNECTED</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="FAILED">FAILED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Sequence Number</label>
                <input class="form-input" type="number" name="sequenceNumber" value="1" min="1" />
              </div>
            </div>
            <button type="submit" class="btn btn--primary">Process Event</button>
          </form>
        </div>
      </div>

      <div id="tickResult"></div>
    `}
  `;
}

async function triggerTickForm(event) {
  event.preventDefault();
  const form = event.target;
  const campaignId = form.campaignId.value;
  const mode = form.mode.value;
  await triggerTick(campaignId, mode);
}

async function triggerTick(campaignId, mode) {
  const resultDiv = document.getElementById('tickResult') || document.getElementById('pageContent');
  resultDiv.innerHTML = showLoading('Running dialer tick...');

  try {
    const body = {};
    if (mode) body.mode = mode;
    const result = await api(`/campaigns/${campaignId}/tick`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    toast(`Tick complete: ${result.tickResult.callsSucceeded} succeeded, ${result.tickResult.callsFailed} failed`, 'success');

    resultDiv.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Tick Result</span></div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Mode</div><div class="detail-value">${escapeHtml(result.mode)}</div></div>
            <div class="detail-item"><div class="detail-label">Calls Attempted</div><div class="detail-value">${result.tickResult.callsAttempted}</div></div>
            <div class="detail-item"><div class="detail-label">Calls Succeeded</div><div class="detail-value">${result.tickResult.callsSucceeded}</div></div>
            <div class="detail-item"><div class="detail-label">Calls Failed</div><div class="detail-value">${result.tickResult.callsFailed}</div></div>
            <div class="detail-item"><div class="detail-label">Available Agents</div><div class="detail-value">${result.tickResult.availableAgents ?? '—'}</div></div>
            <div class="detail-item"><div class="detail-label">Safe Capacity</div><div class="detail-value">${result.tickResult.safeCapacity ?? '—'}</div></div>
            <div class="detail-item"><div class="detail-label">Events Processed</div><div class="detail-value">${result.drainedEventsProcessed}</div></div>
            ${result.tickResult.predictedAnswerRate !== undefined ? `
              <div class="detail-item"><div class="detail-label">Predicted Answer Rate</div><div class="detail-value">${(result.tickResult.predictedAnswerRate * 100).toFixed(1)}%</div></div>
              <div class="detail-item"><div class="detail-label">Raw Prediction</div><div class="detail-value">${result.tickResult.rawPrediction}</div></div>
              <div class="detail-item"><div class="detail-label">Safety Approved</div><div class="detail-value">${result.tickResult.safetyApproved}</div></div>
              <div class="detail-item"><div class="detail-label">Safety Reason</div><div class="detail-value" style="font-size:12px;">${escapeHtml(result.tickResult.safetyReason || '')}</div></div>
            ` : ''}
          </div>
          ${result.tickResult.allocations && result.tickResult.allocations.length > 0 ? `
            <h4 class="mt-16 mb-16" style="font-size:14px;">Allocations</h4>
            ${renderTable(
              ['Success', 'Call ID', 'Agent ID', 'Borrower ID', 'Failure Reason'],
              result.tickResult.allocations.map(a => `
                <tr>
                  <td>${a.success ? '<span class="badge badge--success">Success</span>' : '<span class="badge badge--error">Failed</span>'}</td>
                  <td class="text-mono text-sm">${truncate(a.call?.id)}</td>
                  <td class="text-mono text-sm">${truncate(a.agent?.id)}</td>
                  <td class="text-mono text-sm">${truncate(a.borrower?.id)}</td>
                  <td class="text-sm text-muted">${escapeHtml(a.failureReason || '')}</td>
                </tr>
              `)
            )}
          ` : ''}
        </div>
      </div>
    `;
  } catch (err) {
    resultDiv.innerHTML = `<div class="empty-state"><div class="empty-state-title">Tick failed</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
  }
}

async function processEventForm(event) {
  event.preventDefault();
  const form = event.target;
  try {
    const result = await api('/events', {
      method: 'POST',
      body: JSON.stringify({
        eventId: form.eventId.value,
        providerCallId: form.providerCallId.value,
        eventType: form.eventType.value,
        sequenceNumber: parseInt(form.sequenceNumber.value),
        timestamp: new Date().toISOString(),
        payload: {},
      }),
    });
    if (result.processed) {
      toast(`Event processed: ${result.previousState} → ${result.newState}`, 'success');
    } else if (result.duplicate) {
      toast('Duplicate event ignored', 'info');
    } else if (result.stale) {
      toast('Stale event ignored', 'info');
    } else if (result.invalidTransition) {
      toast(`Invalid transition: ${result.reason}`, 'error');
    } else {
      toast(result.reason || 'Event not processed', 'error');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ============================================================================
// SIMULATION PAGE
// ============================================================================
async function renderSimulation(container) {
  let scenarios = [];
  try { scenarios = await api('/simulation/scenarios'); } catch {}

  container.innerHTML = `
    <div class="page-title">Simulation</div>
    <div class="page-description">Run benchmark scenarios comparing progressive vs. predictive dialing.</div>

    <div class="card mb-24">
      <div class="card-header"><span class="card-title">Benchmark Scenarios</span></div>
      <div class="card-body" style="padding:0;">
        ${renderTable(
          ['Scenario', 'Description', 'Agents', 'Borrowers', 'Ticks', 'Provider', 'Actions'],
          scenarios.map(s => `
            <tr>
              <td style="font-weight:600;">${escapeHtml(s.name)}</td>
              <td class="text-sm text-muted">${escapeHtml(s.description)}</td>
              <td>${s.params.numAgents}</td>
              <td>${s.params.numBorrowers}</td>
              <td>${s.params.numTicks}</td>
              <td><span class="badge badge--${s.params.providerType === 'reliable' ? 'success' : 'warning'}">${escapeHtml(s.params.providerType)}</span></td>
              <td><button class="btn btn--sm btn--primary" onclick="runScenario('${s.id}')">Run</button></td>
            </tr>
          `),
          { emptyTitle: 'No scenarios', emptyText: 'Scenarios will appear here.' }
        )}
      </div>
    </div>

    <div class="card mb-24">
      <div class="card-header"><span class="card-title">Custom Simulation</span></div>
      <div class="card-body">
        <form onsubmit="runCustomSim(event)">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Mode</label>
              <select class="form-select" name="mode" required>
                <option value="progressive">Progressive</option>
                <option value="predictive">Predictive</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Provider Type</label>
              <select class="form-select" name="providerType" required>
                <option value="reliable">Reliable</option>
                <option value="unreliable">Unreliable</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Number of Agents</label>
              <input class="form-input" type="number" name="numAgents" value="20" min="1" required />
            </div>
            <div class="form-group">
              <label class="form-label">Number of Borrowers</label>
              <input class="form-input" type="number" name="numBorrowers" value="100" min="1" required />
            </div>
            <div class="form-group">
              <label class="form-label">Number of Ticks</label>
              <input class="form-input" type="number" name="numTicks" value="15" min="1" required />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Answer Rate (0-1)</label>
              <input class="form-input" type="number" step="0.05" name="answerRate" value="0.5" min="0" max="1" />
            </div>
            <div class="form-group">
              <label class="form-label">Failure Rate (0-1)</label>
              <input class="form-input" type="number" step="0.01" name="failureRate" value="0.02" min="0" max="1" />
            </div>
            <div class="form-group">
              <label class="form-label">Seed</label>
              <input class="form-input" type="number" name="seed" value="42" />
            </div>
          </div>
          <button type="submit" class="btn btn--primary">Run Simulation</button>
        </form>
      </div>
    </div>

    <div id="simResult"></div>
  `;
}

async function runScenario(scenarioId) {
  const resultDiv = document.getElementById('simResult');
  resultDiv.innerHTML = showLoading('Running scenario (comparing progressive vs predictive)...');

  try {
    const result = await api(`/simulation/scenarios/${scenarioId}/run`, { method: 'POST' });
    toast('Scenario completed', 'success');
    resultDiv.innerHTML = renderScenarioComparison(result);
  } catch (err) {
    resultDiv.innerHTML = `<div class="empty-state"><div class="empty-state-title">Simulation failed</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
  }
}

async function runCustomSim(event) {
  event.preventDefault();
  const form = event.target;
  const resultDiv = document.getElementById('simResult');
  resultDiv.innerHTML = showLoading('Running simulation...');

  try {
    const params = {
      mode: form.mode.value,
      providerType: form.providerType.value,
      numAgents: parseInt(form.numAgents.value),
      numBorrowers: parseInt(form.numBorrowers.value),
      numTicks: parseInt(form.numTicks.value),
      answerRate: parseFloat(form.answerRate.value),
      failureRate: parseFloat(form.failureRate.value),
      seed: parseInt(form.seed.value),
    };
    const result = await api('/simulation/run', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    toast('Simulation completed', 'success');
    resultDiv.innerHTML = renderSimResult(result);
  } catch (err) {
    resultDiv.innerHTML = `<div class="empty-state"><div class="empty-state-title">Simulation failed</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function renderScenarioComparison(result) {
  const s = result.scenario;
  const p = result.progressive;
  const pred = result.predictive;

  return `
    <div class="card">
      <div class="card-header"><span class="card-title">${escapeHtml(s.name)} — Comparison</span></div>
      <div class="card-body">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Metric</th><th>Progressive</th><th>Predictive</th></tr></thead>
            <tbody>
              ${comparisonRow('Total Calls', p.totals.totalCalls, pred.totals.totalCalls)}
              ${comparisonRow('Completed Calls', p.totals.completedCalls, pred.totals.completedCalls)}
              ${comparisonRow('Failed Calls', p.totals.failedCalls, pred.totals.failedCalls)}
              ${comparisonRow('Cancelled Calls', p.totals.cancelledCalls, pred.totals.cancelledCalls)}
              ${comparisonRow('Borrowers Completed', p.totals.completedBorrowers, pred.totals.completedBorrowers)}
              ${comparisonRow('Borrowers Exhausted', p.totals.exhaustedBorrowers, pred.totals.exhaustedBorrowers)}
              ${comparisonRow('Events Processed', p.totals.totalEventsProcessed, pred.totals.totalEventsProcessed)}
              ${comparisonRow('Duplicates Rejected', p.totals.totalDuplicatesRejected, pred.totals.totalDuplicatesRejected)}
              ${comparisonRow('Stale Rejected', p.totals.totalStaleRejected, pred.totals.totalStaleRejected)}
              ${comparisonRow('Duration (ms)', p.durationMs, pred.durationMs)}
            </tbody>
          </table>
        </div>

        <h4 class="mt-24 mb-16" style="font-size:14px;">Invariants</h4>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Invariant</th><th>Progressive</th><th>Predictive</th></tr></thead>
            <tbody>
              <tr><td>No Double Reservation</td><td>${p.invariants.noDoubleReservation ? '<span class="badge badge--success">PASSED</span>' : '<span class="badge badge--error">FAILED</span>'}</td><td>${pred.invariants.noDoubleReservation ? '<span class="badge badge--success">PASSED</span>' : '<span class="badge badge--error">FAILED</span>'}</td></tr>
              <tr><td>All Calls Terminal</td><td>${p.invariants.allCallsTerminal ? '<span class="badge badge--success">PASSED</span>' : '<span class="badge badge--error">FAILED</span>'}</td><td>${pred.invariants.allCallsTerminal ? '<span class="badge badge--success">PASSED</span>' : '<span class="badge badge--error">FAILED</span>'}</td></tr>
              <tr><td>No Orphaned Agents</td><td>${p.invariants.noOrphanedAgents ? '<span class="badge badge--success">PASSED</span>' : '<span class="badge badge--error">FAILED</span>'}</td><td>${pred.invariants.noOrphanedAgents ? '<span class="badge badge--success">PASSED</span>' : '<span class="badge badge--error">FAILED</span>'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function comparisonRow(label, prog, pred) {
  const max = Math.max(prog, pred);
  return `
    <tr>
      <td style="font-weight:600;">${escapeHtml(label)}</td>
      <td>${prog}${prog === max && prog > 0 ? ' <span class="badge badge--success">best</span>' : ''}</td>
      <td>${pred}${pred === max && pred > 0 ? ' <span class="badge badge--success">best</span>' : ''}</td>
    </tr>
  `;
}

function renderSimResult(r) {
  return `
    <div class="card">
      <div class="card-header"><span class="card-title">Simulation Result — ${escapeHtml(r.mode)}</span></div>
      <div class="card-body">
        <div class="stat-grid">
          <div class="stat-card"><div class="stat-label">Total Calls</div><div class="stat-value">${r.totals.totalCalls}</div></div>
          <div class="stat-card stat-card--success"><div class="stat-label">Completed</div><div class="stat-value">${r.totals.completedCalls}</div></div>
          <div class="stat-card stat-card--error"><div class="stat-label">Failed</div><div class="stat-value">${r.totals.failedCalls}</div></div>
          <div class="stat-card"><div class="stat-label">Borrowers Completed</div><div class="stat-value">${r.totals.completedBorrowers}</div></div>
          <div class="stat-card"><div class="stat-label">Events Processed</div><div class="stat-value">${r.totals.totalEventsProcessed}</div></div>
          <div class="stat-card"><div class="stat-label">Duration</div><div class="stat-value">${r.durationMs}ms</div></div>
        </div>

        <h4 class="mb-16" style="font-size:14px;">Invariants</h4>
        <div class="detail-grid mb-24">
          <div class="detail-item"><div class="detail-label">No Double Reservation</div><div class="detail-value">${r.invariants.noDoubleReservation ? 'PASSED' : 'FAILED'}</div></div>
          <div class="detail-item"><div class="detail-label">All Calls Terminal</div><div class="detail-value">${r.invariants.allCallsTerminal ? 'PASSED' : 'FAILED'}</div></div>
          <div class="detail-item"><div class="detail-label">No Orphaned Agents</div><div class="detail-value">${r.invariants.noOrphanedAgents ? 'PASSED' : 'FAILED'}</div></div>
          <div class="detail-item"><div class="detail-label">Agent-Call Consistency</div><div class="detail-value">${r.invariants.agentCallInvariant ? 'PASSED' : 'FAILED'}</div></div>
        </div>

        <h4 class="mb-16" style="font-size:14px;">Tick-by-Tick Metrics</h4>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Tick</th><th>Attempted</th><th>Succeeded</th><th>Failed</th><th>Events</th><th>Avail. Agents</th><th>Busy Agents</th><th>Eligible</th><th>Completed</th></tr></thead>
            <tbody>
              ${r.ticks.map(t => `
                <tr>
                  <td>${t.tick}</td>
                  <td>${t.callsAttempted}</td>
                  <td>${t.callsSucceeded}</td>
                  <td>${t.callsFailed}</td>
                  <td>${t.eventsProcessed}</td>
                  <td>${t.agentsAvailable}</td>
                  <td>${t.agentsBusy}</td>
                  <td>${t.borrowersEligible}</td>
                  <td>${t.borrowersCompleted}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// PROVIDER HEALTH PAGE
// ============================================================================
async function renderProviders(container) {
  let providers = [];
  try { providers = await api('/providers/health'); } catch {}

  container.innerHTML = `
    <div class="page-title">Provider Health</div>
    <div class="page-description">Telecom provider health metrics and statistics.</div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total Providers</div><div class="stat-value">${providers.length}</div></div>
      <div class="stat-card stat-card--success"><div class="stat-label">Healthy</div><div class="stat-value">${providers.filter(p => p.healthStatus === 'HEALTHY').length}</div></div>
      <div class="stat-card stat-card--warning"><div class="stat-label">Degraded</div><div class="stat-value">${providers.filter(p => p.healthStatus === 'DEGRADED').length}</div></div>
      <div class="stat-card stat-card--error"><div class="stat-label">Unhealthy</div><div class="stat-value">${providers.filter(p => p.healthStatus === 'UNHEALTHY').length}</div></div>
    </div>

    <div class="table-wrapper">
      ${renderTable(
        ['Provider', 'Status', 'Total Calls', 'Successful', 'Failed', 'Timed Out', 'Consecutive Failures', 'Last Failure', 'Last Success'],
        providers.map(p => `
          <tr>
            <td style="font-weight:600;">${escapeHtml(p.providerName)}</td>
            <td>${statusBadge(p.healthStatus)}</td>
            <td>${p.totalCalls}</td>
            <td>${p.successfulCalls}</td>
            <td>${p.failedCalls}</td>
            <td>${p.timedOutCalls}</td>
            <td>${p.consecutiveFailures}</td>
            <td class="text-sm">${formatTime(p.lastFailureAt)}</td>
            <td class="text-sm">${formatTime(p.lastSuccessAt)}</td>
          </tr>
        `),
        { emptyTitle: 'No provider data', emptyText: 'Provider health will appear after calls are made.' }
      )}
    </div>
  `;
}

// ============================================================================
// RECOVERY PAGE
// ============================================================================
async function renderRecovery(container) {
  const campaigns = await api('/campaigns');
  campaignsCache = campaigns;

  container.innerHTML = `
    <div class="page-title">Recovery</div>
    <div class="page-description">Reclaim stale agent reservations and abandoned call allocations.</div>

    <div class="card mb-24">
      <div class="card-header"><span class="card-title">Run Stale Reservation Recovery</span></div>
      <div class="card-body">
        <form onsubmit="runRecovery(event)">
          <div class="form-group">
            <label class="form-label">Campaign (optional — leave empty for all)</label>
            <select class="form-select" name="campaignId">
              <option value="">All campaigns</option>
              ${campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="btn btn--primary">Run Recovery</button>
        </form>
      </div>
    </div>

    <div id="recoveryResult"></div>
  `;
}

async function runRecovery(event) {
  event.preventDefault();
  const form = event.target;
  const campaignId = form.campaignId.value;
  const resultDiv = document.getElementById('recoveryResult');
  resultDiv.innerHTML = showLoading('Running recovery...');

  try {
    const body = {};
    if (campaignId) body.campaignId = campaignId;
    const result = await api('/recovery/stale', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const s = result.summary;
    toast(`Recovery complete: ${s.agentsReclaimed} agents reclaimed`, 'success');

    resultDiv.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Recovery Summary</span></div>
        <div class="card-body">
          <div class="stat-grid">
            <div class="stat-card stat-card--success"><div class="stat-label">Agents Reclaimed</div><div class="stat-value">${s.agentsReclaimed}</div></div>
            <div class="stat-card stat-card--error"><div class="stat-label">Calls Failed</div><div class="stat-value">${s.callsFailed}</div></div>
            <div class="stat-card"><div class="stat-label">Borrowers Released</div><div class="stat-value">${s.borrowersReleased}</div></div>
            <div class="stat-card"><div class="stat-label">Borrowers Exhausted</div><div class="stat-value">${s.borrowersExhausted}</div></div>
          </div>
          <p class="text-muted text-sm">${escapeHtml(result.message)}</p>
        </div>
      </div>
    `;
  } catch (err) {
    resultDiv.innerHTML = `<div class="empty-state"><div class="empty-state-title">Recovery failed</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
  }
}

// ============================================================================
// SETTINGS PAGE
// ============================================================================
async function renderSettings(container) {
  try {
    const health = await fetch('/health').then(r => r.json());
    container.innerHTML = `
      <div class="page-title">Settings</div>
      <div class="page-description">System configuration and status information.</div>

      <div class="card mb-24">
        <div class="card-header"><span class="card-title">System Status</span></div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Service</div><div class="detail-value">${escapeHtml(health.service)}</div></div>
            <div class="detail-item"><div class="detail-label">Status</div><div class="detail-value">${statusBadge(health.status)}</div></div>
            <div class="detail-item"><div class="detail-label">Pacing Mode</div><div class="detail-value">${escapeHtml(health.pacingMode)}</div></div>
            <div class="detail-item"><div class="detail-label">Timestamp</div><div class="detail-value">${formatTime(health.timestamp)}</div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Configuration</span></div>
        <div class="card-body">
          <p class="text-muted text-sm mb-16">
            Operational parameters are configured via environment variables with sensible defaults.
            See the <code>config.ts</code> file for all available settings.
          </p>
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-label">Pacing Interval</div><div class="detail-value">2000ms (default)</div></div>
            <div class="detail-item"><div class="detail-label">Max Concurrent Calls</div><div class="detail-value">500 (default)</div></div>
            <div class="detail-item"><div class="detail-label">Safety Buffer</div><div class="detail-value">2 agents (default)</div></div>
            <div class="detail-item"><div class="detail-label">Max Abandon Rate</div><div class="detail-value">3% (regulatory)</div></div>
            <div class="detail-item"><div class="detail-label">Max Overdial Ratio</div><div class="detail-value">1.5x (default)</div></div>
            <div class="detail-item"><div class="detail-label">Retry Max Attempts</div><div class="detail-value">3 (default)</div></div>
            <div class="detail-item"><div class="detail-label">Stale Reservation Timeout</div><div class="detail-value">60s (default)</div></div>
            <div class="detail-item"><div class="detail-label">Provider Timeout</div><div class="detail-value">10000ms (default)</div></div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('pacingModeBadge').textContent = health.pacingMode.charAt(0).toUpperCase() + health.pacingMode.slice(1);
  } catch {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Unable to load settings</div><div class="empty-state-text">The backend may not be running.</div></div>`;
  }
}

// ============================================================================
// INIT
// ============================================================================
function handleRoute() {
  const hash = window.location.hash.replace('#', '') || '/';
  navigate(hash);
}

window.addEventListener('hashchange', handleRoute);

document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
});

document.addEventListener('DOMContentLoaded', () => {
  handleRoute();
});

const state = {
  refreshSeconds: 60,
  refreshTimer: null,
  isLoading: false
};

const elements = {
  totalLeads: document.getElementById('totalLeads'),
  totalCampaigns: document.getElementById('totalCampaigns'),
  totalSalesValue: document.getElementById('totalSalesValue'),
  totalLeadsWithValue: document.getElementById('totalLeadsWithValue'),
  campaignContainer: document.getElementById('campaignContainer'),
  emptyState: document.getElementById('emptyState'),
  periodLabel: document.getElementById('periodLabel'),
  autoRefreshLabel: document.getElementById('autoRefreshLabel'),
  fromDate: document.getElementById('fromDate'),
  toDate: document.getElementById('toDate'),
  applyFilterButton: document.getElementById('applyFilterButton'),
  currentMonthButton: document.getElementById('currentMonthButton'),
  refreshButton: document.getElementById('refreshButton'),
  campaignTemplate: document.getElementById('campaignTemplate')
};

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function toLocalDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: toLocalDateInputValue(firstDay),
    to: toLocalDateInputValue(lastDay)
  };
}

function setCurrentMonthInputs() {
  const { from, to } = getCurrentMonthRange();
  elements.fromDate.value = from;
  elements.toDate.value = to;
}

function showMessage(className, message) {
  elements.emptyState.className = className;
  elements.emptyState.innerHTML = message;
}

function clearCampaigns() {
  elements.campaignContainer.innerHTML = '';
}

function renderSummary(summary) {
  elements.totalLeads.textContent = formatInteger(summary.total_meta_leads);
  elements.totalCampaigns.textContent = formatInteger(summary.total_campaigns);
  elements.totalSalesValue.textContent = formatCurrency(summary.total_sales_value);
  elements.totalLeadsWithValue.textContent = formatInteger(summary.total_leads_with_value);
}

function renderCampaigns(campaigns) {
  clearCampaigns();

  if (!campaigns.length) {
    showMessage('empty-state', 'Nenhum lead com <strong>utm_source = meta_ads</strong> foi encontrado no período.');
    return;
  }

  elements.emptyState.className = 'empty-state hidden';

  for (const campaign of campaigns) {
    const fragment = elements.campaignTemplate.content.cloneNode(true);

    fragment.querySelector('.campaign-name').textContent = campaign.utm_campaign;
    fragment.querySelector('.campaign-subtitle').textContent = `${formatInteger(campaign.leads_with_value)} lead(s) com valor preenchido`;
    fragment.querySelector('.leads-count').textContent = formatInteger(campaign.total_leads);
    fragment.querySelector('.sales-value').textContent = formatCurrency(campaign.total_sales_value);

    const stagesList = fragment.querySelector('.stages-list');
    for (const stage of campaign.stages) {
      const node = document.createElement('div');
      node.className = 'stage-row';
      node.innerHTML = `
        <div class="stage-label">
          <strong>${escapeHtml(stage.stage)}</strong><br>
          <small>${escapeHtml(stage.pipeline)}</small>
        </div>
        <div class="stage-count">${formatInteger(stage.count)}</div>
      `;
      stagesList.appendChild(node);
    }

    const leadsRows = fragment.querySelector('.lead-rows');
    for (const lead of campaign.leads.slice(0, 12)) {
      const node = document.createElement('div');
      node.className = 'lead-row';
      node.innerHTML = `
        <div>
          <div class="lead-name">${escapeHtml(lead.name)}</div>
          <div class="lead-meta">${escapeHtml(lead.pipeline)} • ${escapeHtml(lead.stage)}</div>
        </div>
        <div class="lead-price">${formatCurrency(lead.price)}</div>
      `;
      leadsRows.appendChild(node);
    }

    if (campaign.leads.length > 12) {
      const more = document.createElement('div');
      more.className = 'lead-row';
      more.innerHTML = `<div class="lead-meta">+ ${formatInteger(campaign.leads.length - 12)} lead(s) ocultos</div>`;
      leadsRows.appendChild(more);
    }

    elements.campaignContainer.appendChild(fragment);
  }
}

function renderPeriod(period, refreshSeconds) {
  elements.periodLabel.textContent = `Período: ${period.start} até ${period.end} (${period.timezone})`;
  elements.autoRefreshLabel.textContent = `Autoatualização: a cada ${refreshSeconds}s`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchDashboard() {
  if (state.isLoading) return;
  state.isLoading = true;
  clearCampaigns();
  showMessage('loading-state', 'Carregando dados da Kommo...');

  const params = new URLSearchParams();
  if (elements.fromDate.value) params.set('from', elements.fromDate.value);
  if (elements.toDate.value) params.set('to', elements.toDate.value);

  try {
    const response = await fetch(`/api/meta-dashboard?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Erro ao carregar o painel.');
    }

    state.refreshSeconds = Number(data.refresh_seconds || 60);
    renderSummary(data.summary);
    renderCampaigns(data.campaigns || []);
    renderPeriod(data.period, state.refreshSeconds);
    scheduleRefresh();
  } catch (error) {
    showMessage('error-state', `Falha ao carregar os dados: <strong>${escapeHtml(error.message)}</strong>`);
  } finally {
    state.isLoading = false;
  }
}

function scheduleRefresh() {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(fetchDashboard, state.refreshSeconds * 1000);
}

function bindEvents() {
  elements.applyFilterButton.addEventListener('click', fetchDashboard);
  elements.currentMonthButton.addEventListener('click', () => {
    setCurrentMonthInputs();
    fetchDashboard();
  });
  elements.refreshButton.addEventListener('click', fetchDashboard);
}

setCurrentMonthInputs();
bindEvents();
fetchDashboard();

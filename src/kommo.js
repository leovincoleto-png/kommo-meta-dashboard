const axios = require('axios');
const { DateTime } = require('luxon');

const REQUIRED_ENV = ['KOMMO_SUBDOMAIN', 'KOMMO_LONG_LIVED_TOKEN'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    // Deixa a validação final para o bootstrap, mas mantém aviso útil em dev.
    console.warn(`[kommo] Variável ausente: ${key}`);
  }
}

const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const KOMMO_LONG_LIVED_TOKEN = process.env.KOMMO_LONG_LIVED_TOKEN;
const KOMMO_UTM_SOURCE_FIELD_NAME = (process.env.KOMMO_UTM_SOURCE_FIELD_NAME || 'utm_source').trim();
const KOMMO_UTM_CAMPAIGN_FIELD_NAME = (process.env.KOMMO_UTM_CAMPAIGN_FIELD_NAME || 'utm_campaign').trim();
const KOMMO_UTM_SOURCE_EXPECTED = (process.env.KOMMO_UTM_SOURCE_EXPECTED || 'meta_ads').trim().toLowerCase();
const KOMMO_TIMEZONE = process.env.KOMMO_TIMEZONE || 'America/Sao_Paulo';

const api = axios.create({
  baseURL: `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4`,
  timeout: 30000,
  headers: {
    Authorization: `Bearer ${KOMMO_LONG_LIVED_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
});

const cache = {
  customFields: { value: null, expiresAt: 0 },
  stages: { value: null, expiresAt: 0 },
  dashboardResponses: new Map()
};

function nowMs() {
  return Date.now();
}

function getCacheEntry(entry) {
  if (entry && entry.value && entry.expiresAt > nowMs()) {
    return entry.value;
  }
  return null;
}

function setCacheEntry(entry, value, ttlMs) {
  entry.value = value;
  entry.expiresAt = nowMs() + ttlMs;
}

function setMapCache(map, key, value, ttlMs) {
  map.set(key, { value, expiresAt: nowMs() + ttlMs });
}

function getMapCache(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= nowMs()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cleanupDashboardCache() {
  for (const [key, entry] of cache.dashboardResponses.entries()) {
    if (entry.expiresAt <= nowMs()) {
      cache.dashboardResponses.delete(key);
    }
  }
}

function normalizeString(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function normalizeDisplay(value, fallback = 'Sem campanha') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function getCurrentMonthRange(timezone = KOMMO_TIMEZONE) {
  const start = DateTime.now().setZone(timezone).startOf('month');
  const end = start.endOf('month');
  return { start, end };
}

function parseDateRange({ from, to, timezone = KOMMO_TIMEZONE } = {}) {
  if (from && to) {
    const start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
    const end = DateTime.fromISO(to, { zone: timezone }).endOf('day');

    if (!start.isValid || !end.isValid) {
      throw new Error('Datas inválidas. Use o formato YYYY-MM-DD.');
    }
    if (start > end) {
      throw new Error('A data inicial não pode ser maior que a data final.');
    }
    return { start, end };
  }

  return getCurrentMonthRange(timezone);
}

async function fetchAllPages(url, params = {}) {
  const items = [];
  let page = 1;
  const limit = Math.min(Number(params.limit) || 250, 250);

  while (true) {
    const response = await api.get(url, {
      params: { ...params, page, limit }
    });

    const embedded = response.data?._embedded;
    const collection = embedded ? Object.values(embedded)[0] : [];
    const batch = Array.isArray(collection) ? collection : [];

    items.push(...batch);

    if (batch.length < limit) break;
    page += 1;
    if (page > 1000) {
      throw new Error('Paginação interrompida por segurança. Revise os filtros de período.');
    }
  }

  return items;
}

async function getLeadCustomFields() {
  const hit = getCacheEntry(cache.customFields);
  if (hit) return hit;

  const fields = await fetchAllPages('/leads/custom_fields', { order: 'sort' });
  setCacheEntry(cache.customFields, fields, 10 * 60 * 1000);
  return fields;
}

async function resolveFieldIds() {
  const explicitSourceId = process.env.KOMMO_UTM_SOURCE_FIELD_ID;
  const explicitCampaignId = process.env.KOMMO_UTM_CAMPAIGN_FIELD_ID;

  if (explicitSourceId && explicitCampaignId) {
    return {
      utmSourceFieldId: Number(explicitSourceId),
      utmCampaignFieldId: Number(explicitCampaignId)
    };
  }

  const fields = await getLeadCustomFields();

  const byName = (targetName) =>
    fields.find((field) => normalizeString(field.name) === normalizeString(targetName));

  const sourceField = explicitSourceId ? { id: Number(explicitSourceId) } : byName(KOMMO_UTM_SOURCE_FIELD_NAME);
  const campaignField = explicitCampaignId ? { id: Number(explicitCampaignId) } : byName(KOMMO_UTM_CAMPAIGN_FIELD_NAME);

  if (!sourceField) {
    throw new Error(`Não encontrei o campo de lead "${KOMMO_UTM_SOURCE_FIELD_NAME}" na Kommo.`);
  }
  if (!campaignField) {
    throw new Error(`Não encontrei o campo de lead "${KOMMO_UTM_CAMPAIGN_FIELD_NAME}" na Kommo.`);
  }

  return {
    utmSourceFieldId: Number(sourceField.id),
    utmCampaignFieldId: Number(campaignField.id)
  };
}

function extractCustomFieldText(lead, fieldId) {
  const customFields = Array.isArray(lead.custom_fields_values) ? lead.custom_fields_values : [];
  const field = customFields.find((item) => Number(item.field_id) === Number(fieldId));
  if (!field || !Array.isArray(field.values) || field.values.length === 0) return '';

  const values = field.values
    .map((entry) => entry.value)
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map((value) => String(value).trim());

  return values.join(', ');
}

async function getPipelineStageLookup() {
  const hit = getCacheEntry(cache.stages);
  if (hit) return hit;

  const pipelines = await fetchAllPages('/leads/pipelines');
  const lookup = new Map();

  for (const pipeline of pipelines) {
    const stages = await fetchAllPages(`/leads/pipelines/${pipeline.id}/statuses`);
    for (const stage of stages) {
      lookup.set(`${pipeline.id}:${stage.id}`, {
        pipelineId: Number(pipeline.id),
        pipelineName: pipeline.name,
        stageId: Number(stage.id),
        stageName: stage.name
      });
    }
  }

  setCacheEntry(cache.stages, lookup, 10 * 60 * 1000);
  return lookup;
}

async function getLeadsInRange(start, end) {
  return fetchAllPages('/leads', {
    'filter[created_at][from]': Math.floor(start.toSeconds()),
    'filter[created_at][to]': Math.floor(end.toSeconds()),
    'order[created_at]': 'asc'
  });
}

function aggregateCampaigns({ leads, fields, stagesLookup, start, end }) {
  const { utmSourceFieldId, utmCampaignFieldId } = fields;
  const campaigns = new Map();
  let totalSalesValue = 0;

  for (const lead of leads) {
    const utmSource = normalizeString(extractCustomFieldText(lead, utmSourceFieldId));
    if (utmSource !== KOMMO_UTM_SOURCE_EXPECTED) continue;

    const utmCampaign = normalizeDisplay(extractCustomFieldText(lead, utmCampaignFieldId), 'Sem utm_campaign');
    const stageKey = `${lead.pipeline_id}:${lead.status_id}`;
    const stageData = stagesLookup.get(stageKey) || {
      pipelineId: Number(lead.pipeline_id) || 0,
      pipelineName: 'Pipeline desconhecida',
      stageId: Number(lead.status_id) || 0,
      stageName: 'Etapa desconhecida'
    };

    if (!campaigns.has(utmCampaign)) {
      campaigns.set(utmCampaign, {
        utm_campaign: utmCampaign,
        total_leads: 0,
        total_sales_value: 0,
        leads_with_value: 0,
        leads: [],
        stageBuckets: new Map()
      });
    }

    const bucket = campaigns.get(utmCampaign);
    bucket.total_leads += 1;

    const leadPrice = Number(lead.price || 0);
    if (leadPrice > 0) {
      bucket.total_sales_value += leadPrice;
      bucket.leads_with_value += 1;
      totalSalesValue += leadPrice;
    }

    const stageBucketKey = `${stageData.pipelineName}|||${stageData.stageName}`;
    if (!bucket.stageBuckets.has(stageBucketKey)) {
      bucket.stageBuckets.set(stageBucketKey, {
        pipeline: stageData.pipelineName,
        stage: stageData.stageName,
        count: 0
      });
    }
    bucket.stageBuckets.get(stageBucketKey).count += 1;

    bucket.leads.push({
      id: lead.id,
      name: lead.name || `Lead ${lead.id}`,
      price: leadPrice,
      pipeline: stageData.pipelineName,
      stage: stageData.stageName,
      created_at: lead.created_at
    });
  }

  const campaignList = [...campaigns.values()]
    .map((item) => ({
      utm_campaign: item.utm_campaign,
      total_leads: item.total_leads,
      total_sales_value: item.total_sales_value,
      leads_with_value: item.leads_with_value,
      stages: [...item.stageBuckets.values()].sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage)),
      leads: item.leads.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))
    }))
    .sort((a, b) => b.total_leads - a.total_leads || b.total_sales_value - a.total_sales_value || a.utm_campaign.localeCompare(b.utm_campaign));

  return {
    period: {
      mode: fromAndToProvided(start, end) ? 'custom' : 'current_month',
      start: start.toISODate(),
      end: end.toISODate(),
      timezone: KOMMO_TIMEZONE
    },
    summary: {
      total_meta_leads: campaignList.reduce((sum, item) => sum + item.total_leads, 0),
      total_campaigns: campaignList.length,
      total_sales_value: totalSalesValue,
      total_leads_with_value: campaignList.reduce((sum, item) => sum + item.leads_with_value, 0)
    },
    campaigns: campaignList
  };
}

function fromAndToProvided(start, end) {
  const current = getCurrentMonthRange();
  return start.toISODate() !== current.start.toISODate() || end.toISODate() !== current.end.toISODate();
}

async function getMetaDashboardData({ from, to } = {}) {
  cleanupDashboardCache();

  const { start, end } = parseDateRange({ from, to, timezone: KOMMO_TIMEZONE });
  const cacheKey = `${start.toISODate()}__${end.toISODate()}`;
  const cached = getMapCache(cache.dashboardResponses, cacheKey);
  if (cached) return cached;

  const [fields, stagesLookup, leads] = await Promise.all([
    resolveFieldIds(),
    getPipelineStageLookup(),
    getLeadsInRange(start, end)
  ]);

  const result = aggregateCampaigns({ leads, fields, stagesLookup, start, end });
  setMapCache(cache.dashboardResponses, cacheKey, result, 30 * 1000);
  return result;
}

module.exports = {
  getMetaDashboardData,
  parseDateRange,
  getCurrentMonthRange
};

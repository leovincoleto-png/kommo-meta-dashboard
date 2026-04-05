require('dotenv').config();

const path = require('path');
const express = require('express');
const { getMetaDashboardData } = require('./kommo');

const app = express();
const port = Number(process.env.PORT || 3000);
const refreshSeconds = Number(process.env.DASHBOARD_REFRESH_SECONDS || 60);

const requiredEnv = ['KOMMO_SUBDOMAIN', 'KOMMO_LONG_LIVED_TOKEN'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Variável obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kommo-meta-dashboard', refresh_seconds: refreshSeconds });
});

app.get('/api/meta-dashboard', async (req, res) => {
  try {
    const data = await getMetaDashboardData({
      from: req.query.from,
      to: req.query.to
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      refresh_seconds: refreshSeconds,
      ...data
    });
  } catch (error) {
    const status = /Datas inválidas|não pode ser maior/i.test(error.message) ? 400 : 500;
    res.status(status).json({
      ok: false,
      error: error.message || 'Erro ao buscar dados da Kommo.'
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Painel Kommo disponível em http://localhost:${port}`);
});

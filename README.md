# Painel Meta Ads para Kommo

Projeto pronto para hospedar um **painel externo** no dashboard da Kommo, trazendo:

- total de leads com `utm_source = meta_ads`
- agrupamento por `utm_campaign`
- etapa atual do lead
- valor da venda usando o campo nativo `price`
- período padrão no **mês atual**
- atualização automática a cada 60 segundos
- filtro próprio de período dentro do painel

## Como funciona

A página do painel é exibida no dashboard da Kommo por uma **URL externa**. O frontend chama um backend seu, e o backend consulta a API da Kommo com **private integration + long-lived token**.

Fluxo:

```text
Kommo Dashboard -> sua URL pública -> backend Node.js -> API da Kommo
```

## Estrutura do projeto

```text
kommo-meta-dashboard/
  .env.example
  package.json
  README.md
  public/
    index.html
    styles.css
    app.js
  src/
    server.js
    kommo.js
```

## 1) Criar a integração privada na Kommo

Na sua conta Kommo:

1. Vá em **Configurações > Integrações**
2. Clique em **Criar integração**
3. Gere o **long-lived token**
4. Guarde também o **subdomínio** da conta

## 2) Descobrir os nomes dos campos

O projeto tenta localizar automaticamente estes campos pelo nome:

- `utm_source`
- `utm_campaign`

Se na sua Kommo eles tiverem outro nome, altere no `.env`.

## 3) Configurar o ambiente

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Preencha:

```env
PORT=3000
KOMMO_SUBDOMAIN=seusubdominio
KOMMO_LONG_LIVED_TOKEN=cole_seu_token_aqui
KOMMO_UTM_SOURCE_FIELD_NAME=utm_source
KOMMO_UTM_CAMPAIGN_FIELD_NAME=utm_campaign
KOMMO_UTM_SOURCE_EXPECTED=meta_ads
KOMMO_TIMEZONE=America/Sao_Paulo
DASHBOARD_DEFAULT_PERIOD=current_month
DASHBOARD_REFRESH_SECONDS=60
```

### Opcional: fixar os IDs dos campos

Se preferir não depender da busca por nome, preencha também:

```env
KOMMO_UTM_SOURCE_FIELD_ID=123456
KOMMO_UTM_CAMPAIGN_FIELD_ID=789012
```

## 4) Rodar localmente

Instale as dependências:

```bash
npm install
```

Inicie:

```bash
npm start
```

Abra:

```text
http://localhost:3000
```

## 5) Testar a API do painel

Endpoint principal:

```text
GET /api/meta-dashboard
```

Com período customizado:

```text
GET /api/meta-dashboard?from=2026-04-01&to=2026-04-30
```

Saída esperada:

```json
{
  "ok": true,
  "refresh_seconds": 60,
  "period": {
    "mode": "current_month",
    "start": "2026-04-01",
    "end": "2026-04-30",
    "timezone": "America/Sao_Paulo"
  },
  "summary": {
    "total_meta_leads": 42,
    "total_campaigns": 7,
    "total_sales_value": 18500,
    "total_leads_with_value": 9
  },
  "campaigns": [
    {
      "utm_campaign": "consulta-catarata-abril",
      "total_leads": 18,
      "total_sales_value": 9200,
      "leads_with_value": 4,
      "stages": [
        {
          "pipeline": "Recepção",
          "stage": "Contato inicial",
          "count": 7
        }
      ],
      "leads": [
        {
          "id": 123,
          "name": "Lead 123",
          "price": 2500,
          "pipeline": "Cirurgia Particular",
          "stage": "Fechado",
          "created_at": 1712610000
        }
      ]
    }
  ]
}
```

## 6) Hospedar

Você precisa hospedar este projeto em um servidor com **Node.js** e **HTTPS**.

Opções comuns:

- Render
- Railway
- VPS própria
- servidor com Docker / PM2 / Nginx

### Exemplo com Render

1. Suba esta pasta para um repositório no GitHub
2. Crie um novo **Web Service** no Render
3. Conecte o repositório
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Cadastre as variáveis de ambiente do `.env`
6. Publique

A URL final fica algo como:

```text
https://seu-app.onrender.com
```

## 7) Colocar no dashboard da Kommo

Depois de publicado:

1. Abra o dashboard da Kommo
2. Crie o widget externo
3. Cole a URL pública do projeto
4. Ajuste largura e altura
5. Salve

## Regras que este painel usa

- considera somente leads com `utm_source` exatamente igual a `meta_ads`
- usa `utm_campaign` para agrupar
- usa `price` como valor da venda
- usa a **etapa atual** do lead, com base em `pipeline_id` + `status_id`
- quando não houver `utm_campaign`, mostra `Sem utm_campaign`
- quando não houver `price`, conta como zero

## Limitações da versão 1

- o painel não lê, de forma documentada, o seletor nativo de período do dashboard da Kommo
- por isso, o padrão é **mês atual**, mas o painel já traz filtro próprio de datas
- a atualização é por polling, não por webhook

## Melhorias para a versão 2

- filtro por usuário responsável
- filtro por pipeline
- destaque para campanhas com maior faturamento
- exportação CSV
- cache mais avançado
- webhooks para atualizar quase em tempo real

## Observação importante

Nunca coloque o token da Kommo no frontend. Ele deve ficar apenas no backend, nas variáveis de ambiente do servidor.

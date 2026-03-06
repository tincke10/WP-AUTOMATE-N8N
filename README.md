# WP-AUTOMATE: Z-API + GPTMaker + Datacrazy

Servidor puente que conecta WhatsApp (Z-API) con un bot de IA (GPTMaker) y registra leads en Datacrazy CRM. Desplegable como Cloudflare Worker.

## Flujo

```
Cliente WhatsApp → Z-API → Worker /webhook/zapi → GPTMaker
                                                      ↓
Cliente WhatsApp ← Z-API ← Worker /callback/gptmaker ←┘
                                                      ↓
                                          Datacrazy CRM (onFinishCallback)
```

## Estructura

```
src/worker.js          Cloudflare Worker (servidor puente)
n8n/                   Workflows exportables para n8n (alternativa)
wrangler.toml          Configuracion de Cloudflare Worker
.dev.vars.example      Variables de entorno de ejemplo
```

## Setup - Cloudflare Worker

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

Para desarrollo local, copia `.dev.vars.example` a `.dev.vars` y completa tus credenciales:

```bash
cp .dev.vars.example .dev.vars
```

Para produccion, configura los secrets en Cloudflare:

```bash
npx wrangler secret put GPTMAKER_TOKEN
npx wrangler secret put ZAPI_INSTANCE_ID
npx wrangler secret put ZAPI_TOKEN
npx wrangler secret put DATACRAZY_WEBHOOK_URL
npx wrangler secret put WORKER_URL
```

Edita `wrangler.toml` para poner tu `GPTMAKER_AGENT_ID`.

### 3. Desarrollo local

```bash
npm run dev
```

### 4. Deploy a Cloudflare

```bash
npm run deploy
```

### 5. Configurar Z-API

Apunta el webhook `ReceivedCallback` de tu instancia Z-API a:

```
https://wp-automate-zapi-gptmaker.TU_SUBDOMINIO.workers.dev/webhook/zapi
```

## Setup alternativo - n8n

Importa los dos workflows desde la carpeta `n8n/`:

1. **workflow-zapi-to-gptmaker.json** - Recibe mensajes de Z-API y los envia a GPTMaker
2. **workflow-gptmaker-callback.json** - Recibe respuesta de GPTMaker y la envia al cliente via Z-API

### Variables de entorno en n8n

Configura estas variables en Settings > Variables:

| Variable | Valor |
|---|---|
| `GPTMAKER_AGENT_ID` | Tu Agent ID de GPTMaker |
| `ZAPI_INSTANCE_ID` | Tu Instance ID de Z-API |
| `ZAPI_TOKEN` | Tu Token de Z-API |
| `DATACRAZY_WEBHOOK_URL` | URL del webhook de Datacrazy |
| `CALLBACK_URL` | URL publica del webhook del workflow 2 |

### Credenciales en n8n

Crea una credencial tipo "Header Auth" con:
- Name: `GPTMaker Bearer Token`
- Header Name: `Authorization`
- Header Value: `Bearer TU_TOKEN_GPTMAKER`

## Credenciales necesarias

| Sistema | Credencial | Donde encontrarla |
|---|---|---|
| Z-API | Instance ID + Token | Panel Z-API > tu instancia |
| GPTMaker | Agent ID + Bearer Token | Panel GPTMaker > Agente > API |
| Datacrazy | Webhook URL | Configuracoes > Integracoes > Criar |

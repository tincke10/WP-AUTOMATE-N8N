# WP-AUTOMATE: Z-API + GPTMaker + Datacrazy

Servidor puente desplegable en Cloudflare Workers que automatiza la atencion al cliente por WhatsApp usando inteligencia artificial.

## Que hace esta automatizacion

1. Un cliente envia un mensaje por **WhatsApp**
2. **Z-API** captura el mensaje y lo envia al Worker via webhook
3. El Worker valida horario, detecta si hay un operador atendiendo, y si todo esta OK reenvía el mensaje a **GPTMaker**
4. **GPTMaker** procesa el mensaje con IA y devuelve la respuesta al Worker via callback
5. El Worker envia la respuesta al cliente por WhatsApp usando **Z-API send-text**
6. Al finalizar el atendimiento, GPTMaker registra el lead automaticamente en **Datacrazy CRM**

### Funcionalidades extra

- **Horario de atencion configurable** - El bot solo responde dentro del rango horario definido (ej: 8:00 a 22:00). Fuera de horario ignora los mensajes. Se puede desactivar fines de semana.
- **Deteccion de operador humano** - Si un operador responde manualmente desde el WhatsApp del negocio, el bot se pausa automaticamente para ese cliente durante un tiempo configurable (default 30 min). Esto evita que el bot interfiera cuando un humano esta atendiendo.

### Flujo visual

```
Cliente WhatsApp
       |
       v
    Z-API (webhook)
       |
       v
  Worker /webhook/zapi
       |
       |-- Fuera de horario? --> ignora
       |-- Operador atendiendo? --> ignora
       |-- fromMe=true sin marca bot? --> pausa bot (operador tomo control)
       |
       v
    GPTMaker (procesa con IA)
       |
       v
  Worker /callback/gptmaker
       |
       v
    Z-API send-text --> Cliente recibe respuesta
       |
       v
    Datacrazy CRM (registra lead al finalizar)
```

## Estructura del proyecto

```
src/worker.js          Cloudflare Worker (servidor puente)
n8n/                   Workflows exportables para n8n (alternativa visual)
wrangler.toml          Configuracion del Worker y variables de entorno
.dev.vars.example      Ejemplo de variables para desarrollo local
```

## Variables de entorno

### Credenciales (configurar como secrets en produccion)

| Variable | Descripcion | Donde obtenerla |
|---|---|---|
| `GPTMAKER_TOKEN` | Token de autenticacion (incluir prefijo `Bearer `) | Panel GPTMaker > Agente > API |
| `GPTMAKER_AGENT_ID` | ID del agente de GPTMaker | Panel GPTMaker > Agente > URL o panel |
| `ZAPI_INSTANCE_ID` | ID de tu instancia Z-API | Panel Z-API > tu instancia |
| `ZAPI_TOKEN` | Token de tu instancia Z-API | Panel Z-API > tu instancia |
| `DATACRAZY_WEBHOOK_URL` | URL del webhook de Datacrazy CRM | Configuracoes > Integracoes > Criar |
| `WORKER_URL` | URL publica del Worker desplegado | Cloudflare dashboard o output del deploy |

### Horario de atencion

| Variable | Default | Descripcion |
|---|---|---|
| `SCHEDULE_START_HOUR` | `8` | Hora de inicio del bot (0-23) |
| `SCHEDULE_END_HOUR` | `22` | Hora de fin del bot (0-23) |
| `TIMEZONE` | `America/Sao_Paulo` | Zona horaria para calcular la hora local |
| `WEEKEND_ACTIVE` | `true` | `true` = bot activo fines de semana, `false` = inactivo sabado y domingo |

### Deteccion de operador

| Variable | Default | Descripcion |
|---|---|---|
| `PAUSE_TTL_SECONDS` | `1800` | Segundos que el bot se pausa cuando un operador responde (default 30 min) |
| `BOT_SENT_TTL_SECONDS` | `10` | Ventana en segundos para distinguir mensaje del bot vs mensaje del operador |

## Setup - Cloudflare Worker

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear el KV Namespace

```bash
npx wrangler kv namespace create KV
```

Copia el `id` que te devuelve y pegalo en `wrangler.toml` donde dice `TU_KV_NAMESPACE_ID`.

### 3. Configurar variables de entorno

Para desarrollo local:

```bash
cp .dev.vars.example .dev.vars
# Editar .dev.vars con tus credenciales
```

Para produccion, configurar los secrets:

```bash
npx wrangler secret put GPTMAKER_TOKEN
npx wrangler secret put ZAPI_INSTANCE_ID
npx wrangler secret put ZAPI_TOKEN
npx wrangler secret put DATACRAZY_WEBHOOK_URL
npx wrangler secret put WORKER_URL
```

Editar `wrangler.toml` para ajustar `GPTMAKER_AGENT_ID` y las variables de horario/operador.

### 4. Desarrollo local

```bash
npm run dev
```

El Worker corre en `http://localhost:8787`.

### 5. Deploy a Cloudflare

```bash
npm run deploy
```

### 6. Configurar Z-API

En el panel de Z-API, apuntar el webhook `ReceivedCallback` a:

```
https://wp-automate-zapi-gptmaker.TU_SUBDOMINIO.workers.dev/webhook/zapi
```

## Setup alternativo - n8n

Importar los dos workflows desde la carpeta `n8n/`:

1. **workflow-zapi-to-gptmaker.json** - Recibe mensajes de Z-API, filtra y envia a GPTMaker
2. **workflow-gptmaker-callback.json** - Recibe respuesta de GPTMaker y la envia al cliente via Z-API

### Variables de entorno en n8n

Configurar en Settings > Variables:

| Variable | Valor |
|---|---|
| `GPTMAKER_AGENT_ID` | Tu Agent ID de GPTMaker |
| `ZAPI_INSTANCE_ID` | Tu Instance ID de Z-API |
| `ZAPI_TOKEN` | Tu Token de Z-API |
| `DATACRAZY_WEBHOOK_URL` | URL del webhook de Datacrazy |
| `CALLBACK_URL` | URL publica del webhook del workflow 2 |

### Credenciales en n8n

Crear una credencial tipo "Header Auth" con:
- Name: `GPTMaker Bearer Token`
- Header Name: `Authorization`
- Header Value: `Bearer TU_TOKEN_GPTMAKER`

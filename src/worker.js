// Defaults para configuracion (se sobreescriben con variables de entorno)
const DEFAULTS = {
  SCHEDULE_START_HOUR: '8',
  SCHEDULE_END_HOUR: '22',
  TIMEZONE: 'America/Sao_Paulo',
  PAUSE_TTL_SECONDS: '1800',
  BOT_SENT_TTL_SECONDS: '10',
  WEEKEND_ACTIVE: 'true',
};

function getConfig(env) {
  return {
    scheduleStart: parseInt(env.SCHEDULE_START_HOUR || DEFAULTS.SCHEDULE_START_HOUR),
    scheduleEnd: parseInt(env.SCHEDULE_END_HOUR || DEFAULTS.SCHEDULE_END_HOUR),
    timezone: env.TIMEZONE || DEFAULTS.TIMEZONE,
    pauseTtl: parseInt(env.PAUSE_TTL_SECONDS || DEFAULTS.PAUSE_TTL_SECONDS),
    botSentTtl: parseInt(env.BOT_SENT_TTL_SECONDS || DEFAULTS.BOT_SENT_TTL_SECONDS),
    weekendActive: (env.WEEKEND_ACTIVE || DEFAULTS.WEEKEND_ACTIVE) === 'true',
  };
}

function isBotActive(config) {
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  const hour = localTime.getHours();
  const day = localTime.getDay(); // 0=domingo, 6=sabado

  if (!config.weekendActive && (day === 0 || day === 6)) return false;

  return hour >= config.scheduleStart && hour < config.scheduleEnd;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    switch (url.pathname) {
      case '/webhook/zapi':
        return handleZapiWebhook(request, env);
      case '/callback/gptmaker':
        return handleGptmakerCallback(request, env);
      default:
        return new Response('Not Found', { status: 404 });
    }
  },
};

/**
 * Ruta 1: Recibe mensaje de Z-API y lo envia a GPTMaker
 * Z-API -> Worker -> GPTMaker
 *
 * Logica de deteccion de operador:
 * - fromMe=true + NO fue enviado por el bot -> operador respondio -> pausar bot
 * - fromMe=false + bot pausado -> ignorar (operador esta atendiendo)
 * - fromMe=false + bot activo -> reenviar a GPTMaker
 */
async function handleZapiWebhook(request, env) {
  const config = getConfig(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { phone, chatName, text, fromMe } = body;

  if (!phone) {
    return new Response('OK', { status: 200 });
  }

  // Mensaje saliente (fromMe=true)
  if (fromMe) {
    const botSentKey = `bot-sent:${phone}`;
    const wasBotMessage = await env.KV.get(botSentKey);

    if (wasBotMessage) {
      await env.KV.delete(botSentKey);
    } else {
      // Lo envio el operador manualmente -> pausar bot para este telefono
      await env.KV.put(`paused:${phone}`, Date.now().toString(), {
        expirationTtl: config.pauseTtl,
      });
      console.log(`Operador tomo control de ${phone} - bot pausado ${config.pauseTtl / 60} min`);
    }
    return new Response('OK', { status: 200 });
  }

  // Mensaje entrante del cliente (fromMe=false)
  const message = text?.message;
  if (!message) {
    return new Response('OK', { status: 200 });
  }

  // Verificar si estamos fuera del horario de atencion
  if (!isBotActive(config)) {
    console.log(`Fuera de horario (${config.scheduleStart}:00-${config.scheduleEnd}:00 ${config.timezone}). Mensaje ignorado.`);
    return new Response('OK', { status: 200 });
  }

  // Verificar si el bot esta pausado para este telefono
  const isPaused = await env.KV.get(`paused:${phone}`);
  if (isPaused) {
    console.log(`Bot pausado para ${phone} - operador atendiendo. Mensaje ignorado.`);
    return new Response('OK', { status: 200 });
  }

  const callbackUrl = `${env.WORKER_URL}/callback/gptmaker`;

  try {
    const response = await fetch(
      `https://api.gptmaker.ai/v2/agent/${env.GPTMAKER_AGENT_ID}/conversation`,
      {
        method: 'POST',
        headers: {
          Authorization: env.GPTMAKER_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contextId: phone,
          prompt: message,
          chatName: chatName || '',
          phone: phone,
          callbackUrl: callbackUrl,
          onFinishCallback: env.DATACRAZY_WEBHOOK_URL,
        }),
      }
    );

    if (!response.ok) {
      console.error('GPTMaker error:', response.status, await response.text());
      return new Response('GPTMaker request failed', { status: 502 });
    }
  } catch (err) {
    console.error('Error calling GPTMaker:', err.message);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

/**
 * Ruta 2: Recibe respuesta de GPTMaker y la envia al cliente via Z-API
 * GPTMaker callback -> Worker -> Z-API send-text
 */
async function handleGptmakerCallback(request, env) {
  const config = getConfig(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { phone, response: botResponse } = body;

  const botMessage =
    typeof botResponse === 'string'
      ? botResponse
      : botResponse?.text || botResponse?.message || '';

  if (!phone || !botMessage) {
    console.error('Missing phone or message in GPTMaker callback:', JSON.stringify(body));
    return new Response('OK', { status: 200 });
  }

  // Marcar que este mensaje lo envia el bot (para no confundirlo con operador)
  await env.KV.put(`bot-sent:${phone}`, '1', {
    expirationTtl: config.botSentTtl,
  });

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_TOKEN}/send-text`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone,
          message: botMessage,
        }),
      }
    );

    if (!response.ok) {
      console.error('Z-API error:', response.status, await response.text());
      return new Response('Z-API request failed', { status: 502 });
    }
  } catch (err) {
    console.error('Error calling Z-API:', err.message);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

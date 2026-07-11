const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

if (botToken === undefined || botToken.length === 0) {
  console.warn('Telegram webhook registration skipped: TELEGRAM_BOT_TOKEN is not set.');
  process.exit(0);
}

if (webhookUrl === undefined || webhookUrl.length === 0) {
  console.warn('Telegram webhook registration skipped: TELEGRAM_WEBHOOK_URL is not set.');
  process.exit(0);
}

const endpoint = `https://api.telegram.org/bot${botToken}/setWebhook`;
const body = {
  url: webhookUrl,
  allowed_updates: ['message', 'edited_message'],
  ...(webhookSecret === undefined || webhookSecret.length === 0
    ? {}
    : { secret_token: webhookSecret }),
};

let lastError;

for (let attempt = 1; attempt <= 2; attempt += 1) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const responseText = await response.text();
    let payload;

    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(`Telegram returned an invalid response with status ${response.status}.`);
    }

    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.description ?? `Telegram returned status ${response.status}.`);
    }

    console.info(`Telegram webhook registered at ${webhookUrl}.`);
    process.exit(0);
  } catch (cause) {
    lastError = cause;
  }

  if (attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

console.error(
  `Telegram webhook registration failed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
);
process.exit(1);

// Shows what Telegram currently knows about your webhook (errors, pending updates).
const token = Deno.env.get("BOT_TOKEN");
if (!token) {
  console.error("Set BOT_TOKEN in .env first.");
  Deno.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const { result } = await res.json();
// Hide the secret path segment in the printed URL.
if (result?.url) result.url = result.url.replace(/\/webhook\/.+$/, "/webhook/<secret>");
console.log(result);

export {};

/* Настройки Динопарка.
 * wsUrl = null  → только локальный режим (localStorage + BroadcastChannel), подходит для GitHub Pages.
 * wsUrl = "/ws" → WebSocket на том же сервере. При запуске через server/server.js сервер сам
 *                 дописывает к этому файлу { wsUrl: "/ws", server: true }, поэтому вручную ничего менять не нужно.
 * wsUrl = "wss://ваш-сервер.example.com/ws" → статический сайт (например, GitHub Pages) + отдельный сервер синхронизации.
 *
 * SUPPORT_TELEGRAM_URL — ссылка на Telegram поддержки (https://t.me/…). Пусто → в разделе «Поддержка» форма обратной связи.
 * ADMIN_PUBLIC_KEY — ОТКРЫТЫЙ ключ (ECDSA P-256) для проверки подарочных кодов администратора.
 *                    Закрытый ключ хранится только у администратора (admin.html) и сюда не попадает.
 */
window.DP_CONFIG = Object.assign({ wsUrl: null }, window.DP_CONFIG || {}, {
  SUPPORT_TELEGRAM_URL: "",
  ADMIN_PUBLIC_KEY: {"kty":"EC","crv":"P-256","x":"pYvHVMfsKna9Np0iHtU6Q7ne0A8CSS16lI-_SgRx0Vo","y":"nWE9X0ae6xvD3H_dnbW9oAjNeYW7orrtEooPlI-GZS4"}
});

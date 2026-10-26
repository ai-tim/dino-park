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
  ADMIN_PUBLIC_KEY: {"kty":"EC","crv":"P-256","x":"ZIzvhUoPK1_XyYk2n3hJJYn7D-_PUQovLm2AOEBFlbs","y":"bcrkqVgl5cz7ycpMZSXbTkfGEQjvBw6Z7bgXPUy-8D8"}
});

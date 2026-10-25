/* Настройки Динопарка.
 * wsUrl = null  → только локальный режим (localStorage + BroadcastChannel), подходит для GitHub Pages.
 * wsUrl = '/ws' → WebSocket на том же сервере. При запуске через server/server.js этот файл
 *                 автоматически подменяется сервером, поэтому вручную ничего менять не нужно.
 * wsUrl = 'wss://ваш-сервер.example.com/ws' → статический сайт (например, GitHub Pages) + отдельный сервер синхронизации.
 */
window.DP_CONFIG = window.DP_CONFIG || { wsUrl: null };

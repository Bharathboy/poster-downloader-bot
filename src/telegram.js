// src/telegram.js

/**
 * Minimal Telegram wrapper for Cloudflare Workers / Workers-like environment.
 * Provides send/edit/delete helper functions used by the bot code.
 */
export class TelegramBot {
  constructor(token, env) {
    this.apiUrl = `https://api.telegram.org/bot${token}`;
    this.env = env;
  }

  async apiCall(methodName, payload) {
    try {
      const res = await fetch(`${this.apiUrl}/${methodName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json || json.ok === false) {
        // include body for debugging when available
        throw new Error(`Telegram API ${methodName} failed: ${JSON.stringify(json)}`);
      }
      return json;
    } catch (err) {
      console.error(`Telegram API call ${methodName} failed`, err);
      throw err;
    }
  }

  // Core methods used by bot
  sendMessage(chat_id, text, options = {}) {
    return this.apiCall('sendMessage', { chat_id, text, ...options });
  }

  sendPhoto(chat_id, photo, options = {}) {
    return this.apiCall('sendPhoto', { chat_id, photo, ...options });
  }

  editMessageText(chat_id, message_id, text, options = {}) {
    return this.apiCall('editMessageText', { chat_id, message_id, text, ...options });
  }

  editMessageCaption(chat_id, message_id, caption, options = {}) {
    return this.apiCall('editMessageCaption', { chat_id, message_id, caption, ...options });
  }

  editMessageMedia(chat_id, message_id, media, options = {}) {
    return this.apiCall('editMessageMedia', { chat_id, message_id, media, ...options });
  }

  editMessageReplyMarkup(chat_id, message_id, reply_markup = {}) {
    return this.apiCall('editMessageReplyMarkup', { chat_id, message_id, reply_markup });
  }

  deleteMessage(chat_id, message_id) {
    return this.apiCall('deleteMessage', { chat_id, message_id });
  }

  answerCallbackQuery(callback_query_id, options = {}) {
    return this.apiCall('answerCallbackQuery', { callback_query_id, ...options });
  }

  setMyCommands(commands) {
    return this.apiCall('setMyCommands', { commands });
  }

  setWebhook(url, options = {}) {
    return this.apiCall('setWebhook', { url, ...options });
  }

  deleteWebhook() {
    return this.apiCall('deleteWebhook');
  }

  getWebhookInfo() {
    return this.apiCall('getWebhookInfo');
  }
}

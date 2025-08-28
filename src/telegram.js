// src/telegram.js

/**
 * Minimal Telegram wrapper for Cloudflare Workers / Workers-like environment.
 * Provides send/edit/delete helper functions used by the bot code.
 */
export class TelegramBot {
  constructor(token, env) {
    this.token = token;
    this.env = env;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async request(method, data = {}) {
    const url = `${this.apiUrl}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }

  async sendMessage(chat_id, text, options = {}) {
    return this.request('sendMessage', {
      chat_id,
      text,
      ...options
    });
  }

  async sendPhoto(chat_id, photo, options = {}) {
    return this.request('sendPhoto', {
      chat_id,
      photo,
      ...options
    });
  }

  async editMessageText(chat_id, message_id, text, options = {}) {
    return this.request('editMessageText', {
      chat_id,
      message_id,
      text,
      ...options
    });
  }

  async answerCallbackQuery(callback_query_id, options = {}) {
    return this.request('answerCallbackQuery', {
      callback_query_id,
      ...options
    });
  }

  async deleteMessage(chat_id, message_id) {
    return this.request('deleteMessage', {
      chat_id,
      message_id
    });
  }

  async setWebhook(url, options = {}) {
    return this.request('setWebhook', {
      url,
      ...options
    });
  }

  async deleteWebhook() {
    return this.request('deleteWebhook');
  }

  async getWebhookInfo() {
    return this.request('getWebhookInfo');
  }

  async setMyCommands(commands) {
    return this.request('setMyCommands', {
      commands
    });
  }
}

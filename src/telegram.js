// src/telegram.js

/**
 * A lightweight library for interacting with the Telegram Bot API from a Cloudflare Worker.
 */
export class TelegramBot {
    constructor(token, env) {
        this.apiUrl = `https://api.telegram.org/bot${token}`;
        this.env = env;
    }

    /**
     * A generic method to make API calls to Telegram.
     * @param {string} methodName The Telegram API method name.
     * @param {object} payload The JSON payload to send.
     */
    async apiCall(methodName, payload) {
        const response = await fetch(`${this.apiUrl}/${methodName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return response.json();
    }

    sendMessage(chat_id, text, options = {}) {
        return this.apiCall('sendMessage', { chat_id, text, ...options });
    }

    sendPhoto(chat_id, photo, options = {}) {
        return this.apiCall('sendPhoto', { chat_id, photo, ...options });
    }

    editMessageCaption(chat_id, message_id, caption, options = {}) {
        return this.apiCall('editMessageCaption', { chat_id, message_id, caption, ...options });
    }

    editMessageMedia(chat_id, message_id, media, options = {}) {
        return this.apiCall('editMessageMedia', { chat_id, message_id, media, ...options });
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
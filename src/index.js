// src/index.js

import { TelegramBot } from './telegram';

// --- Static Content ---
const ABOUT_TEXT = `*About PosterFlix*\n\nThis bot allows you to preview and download official movie and TV show posters and backdrops from The Movie Database (TMDB).\n\n*Features include:*\n• High-resolution image access\n• Multi-language support\n• Smart search functionality`;
const FAQ_TEXT = `*Frequently Asked Questions*\n\n*Q: Do you host any images?*\nA: No, all images are fetched directly from TMDB's servers in real-time.\n\n*Q: Is this bot affiliated with TMDB?*\nA: This is an independent project using TMDB's public API and is not officially endorsed.`;
const DISCLAIMER_TEXT = `*Legal Disclaimer*\n\nThis bot uses the TMDB API but is not endorsed or certified by TMDB. All images and copyrighted material belong to their respective owners. This service is for personal, non-commercial use only.`;


export default {
    async fetch(request, env, ctx) {
        const bot = new TelegramBot(env.BOT_TOKEN, env);
        const url = new URL(request.url);

        // Handle incoming Telegram updates
        if (request.method === 'POST') {
            const update = await request.json();
            await handleUpdate(bot, update, env);
            return new Response('ok');
        }

        // Handle webhook management
        if (request.method === 'GET') {
            if (url.pathname === '/') {
                const webhookUrl = `${url.protocol}//${url.hostname}/`;
                await bot.setMyCommands([
                    { command: 'start', description: 'Start the bot' },
                    { command: 'about', description: 'About this bot' },
                    { command: 'faq', description: 'Frequently Asked Questions' },
                    { command: 'disclaimer', description: 'Legal Disclaimer' },
                ]);
                const result = await bot.setWebhook(webhookUrl, { drop_pending_updates: true });
                return new Response(`✅ Webhook set to ${webhookUrl}.\nResult: ${JSON.stringify(result)}`);
            }
            if (url.pathname === '/delete') {
                const result = await bot.deleteWebhook();
                return new Response(`✅ Webhook deleted.\nResult: ${JSON.stringify(result)}`);
            }
            if (url.pathname === '/status') {
                const result = await bot.getWebhookInfo();
                return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' }});
            }
        }

        return new Response('Not Found', { status: 404 });
    },
};

/**
 * Main handler for all incoming Telegram updates.
 */
async function handleUpdate(bot, update, env) {
    if (update.message) {
        await handleMessage(bot, update.message, env);
    } else if (update.callback_query) {
        await handleCallback(bot, update.callback_query, env);
    }
}

/**
 * Handles incoming text messages (commands and searches).
 */
async function handleMessage(bot, message, env) {
    const chat_id = message.chat.id;
    const text = message.text || '';

    // Command handling
    if (text.startsWith('/')) {
        const command = text.split(' ')[0];
        if (command === '/start') return bot.sendMessage(chat_id, "Welcome! Send me a movie or TV show name to get started.\n\nE.g., `The Matrix 1999`");
        if (command === '/about') return bot.sendMessage(chat_id, ABOUT_TEXT, { parse_mode: 'Markdown' });
        if (command === '/faq') return bot.sendMessage(chat_id, FAQ_TEXT, { parse_mode: 'Markdown' });
        if (command === '/disclaimer') return bot.sendMessage(chat_id, DISCLAIMER_TEXT, { parse_mode: 'Markdown' });
    }

    // Search handling
    if (!/\d{4}/.test(text)) {
        return bot.sendMessage(chat_id, "Please include the year for better results (e.g., `Inception 2010`).");
    }

    try {
        const apiUrl = `https://tmdbapi-eight.vercel.app/api/movie-posters?query=${encodeURIComponent(text)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
            return bot.sendMessage(chat_id, `😕 Sorry, couldn't find anything for '${text}'. Please check spelling and year.`);
        }
        const data = await response.json();
        const media_id = data.media_id;

        if (!media_id) {
            return bot.sendMessage(chat_id, "Search was successful, but the result is missing an ID. Please try another query.");
        }

        // Cache result in KV for 1 hour
        await env.BOT_STATE.put(`media:${media_id}`, JSON.stringify(data), { expirationTtl: 3600 });
        
        await sendMainMenu(bot, chat_id, data);

    } catch (e) {
        await bot.sendMessage(chat_id, `An error occurred during search: ${e.message}`);
    }
}

/**
 * Handles all button clicks from inline keyboards.
 */
async function handleCallback(bot, callbackQuery, env) {
    const cb_id = callbackQuery.id;
    const chat_id = callbackQuery.message.chat.id;
    const message_id = callbackQuery.message.message_id;
    const [action, ...params] = (callbackQuery.data || '').split(':');

    const media_id = params[params.length - 1];
    const dataStr = await env.BOT_STATE.get(`media:${media_id}`);

    if (!dataStr) {
        return bot.answerCallbackQuery(cb_id, { text: "Sorry, this session has expired. Please search again.", show_alert: true });
    }
    const data = JSON.parse(dataStr);

    switch (action) {
        case 'view': {
            const media_type = params[0];
            const langs = Object.keys(data.images?.[media_type] || {});
            const buttons = langs.sort().map(lang => {
                const lang_name = lang.length === 2 ? lang.toUpperCase() : "No Language";
                const count = data.images[media_type][lang].length;
                return [{ text: `${lang_name} (${count})`, callback_data: `nav:${media_type}:${lang}:0:${media_id}` }];
            });
            buttons.push([{ text: '« Back to Main Menu', callback_data: `back:main:${media_id}` }]);
            
            await bot.editMessageCaption(chat_id, message_id, `Select a language for *${data.title}* ${media_type}:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons },
            });
            break;
        }

        case 'nav': {
            const [media_type, lang, indexStr] = params;
            const index = parseInt(indexStr, 10);
            const image_list = data.images?.[media_type]?.[lang] || [];
            const total = image_list.length;

            if (total === 0) return bot.answerCallbackQuery(cb_id, { text: 'No images found.' });
            
            const newIndex = Math.max(0, Math.min(index, total - 1));
            const row1 = [];
            if (newIndex > 0) row1.push({ text: '⬅️ Prev', callback_data: `nav:${media_type}:${lang}:${newIndex - 1}:${media_id}` });
            row1.push({ text: `${newIndex + 1}/${total}`, callback_data: 'noop' });
            if (newIndex < total - 1) row1.push({ text: 'Next ➡️', callback_data: `nav:${media_type}:${lang}:${newIndex + 1}:${media_id}` });
            
            const buttons = [row1, [{ text: '« Back to Languages', callback_data: `view:${media_type}:${media_id}` }]];
            
            await bot.editMessageMedia(chat_id, message_id, {
                type: 'photo',
                media: image_list[newIndex],
            }, { reply_markup: { inline_keyboard: buttons } });
            break;
        }

        case 'details': {
            const details = `🎬 *${data.title}* (${data.year})\n\n*${data.tagline || ''}*\n\n📖 *Plot:* ${data.plot || 'N/A'}\n\n⭐ *Rating:* ${data.rating || 'N/A'}\n🕒 *Runtime:* ${data.runtime || 'N/A'}\n🎭 *Genres:* ${data.genres || 'N/A'}\n\n🔗 [View on TMDB](${data.url})`;
            await bot.editMessageCaption(chat_id, message_id, details, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '« Back to Main Menu', callback_data: `back:main:${media_id}` }]] },
            });
            break;
        }

        case 'back': {
            await bot.answerCallbackQuery(cb_id); // Answer first to prevent timeout
            await sendMainMenu(bot, chat_id, data, message_id); // Re-send the main menu
            return; // Exit to avoid answering twice
        }
    }
    await bot.answerCallbackQuery(cb_id);
}

/**
 * Sends or edits the main search result message.
 */
async function sendMainMenu(bot, chat_id, data, message_id = null) {
    const caption = `🎬 *${data.title}* (${data.year})\n\n${(data.plot || 'No summary.').substring(0, 800)}`;
    const keyboard = {
        inline_keyboard: [
            [{ text: "🖼️ View Posters", callback_data: `view:posters:${data.media_id}` }, { text: "🏞️ View Backdrops", callback_data: `view:backdrops:${data.media_id}` }],
            [{ text: "ℹ️ Full Details", callback_data: `details:${data.media_id}` }],
        ],
    };

    if (message_id) {
        // If coming back from another view, edit the existing message
        await bot.editMessageMedia(chat_id, message_id, {
            type: 'photo',
            media: data.poster_url || 'https://via.placeholder.com/300x450.png?text=No+Poster',
            caption: caption,
            parse_mode: 'Markdown',
        }, { reply_markup: keyboard });
    } else {
        // If it's a new search, send a new photo
        await bot.sendPhoto(chat_id, data.poster_url || 'https://via.placeholder.com/300x450.png?text=No+Poster', {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    }
}
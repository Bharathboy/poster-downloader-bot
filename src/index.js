// src/index.js

import { TelegramBot } from './telegram';

// --- GLOBAL CONFIG ---
const PARSE_MODE = 'HTML';
const PLACEHOLDER_POSTER = 'https://via.placeholder.com/600x900.png?text=No+Poster+Available';
const CACHE_TTL = 60 * 60 * 2; // 2 hours
const GRID_PAGE_SIZE = 20; // items per page in results grid (4 cols x 5 rows)
const GRID_COLS = 4; // number of numeric buttons per row

// --- Static Content (HTML formatted) ---
const ABOUT_TEXT = `<b>About PosterFlix</b>

PosterFlix helps you preview and download official movie & TV posters and backdrops from The Movie Database (TMDB).

<b>Features</b>
• High-resolution image access
• Multi-language support with quick language switching
• Smart search with optional year hint`;

const FAQ_TEXT = `<b>Frequently Asked Questions</b>

<b>Q: Do you host any images?</b>
A: No — images are hotlinked straight from TMDB in real time.

<b>Q: Is this bot affiliated with TMDB?</b>
A: No. This is an independent project using TMDB's public API.`;

const DISCLAIMER_TEXT = `<b>Legal Disclaimer</b>

This bot uses the TMDB API and is not endorsed by TMDB. All images and copyrights belong to their respective owners. Use for personal, non-commercial purposes only.`;

// ---------------- export worker handler ----------------
export default {
  async fetch(request, env, ctx) {
    const bot = new TelegramBot(env.BOT_TOKEN, env);
    const url = new URL(request.url);

    try {
      if (request.method === 'POST') {
        const update = await request.json();
        await handleUpdate(bot, update, env);
        return new Response('ok');
      }

      if (request.method === 'GET') {
        if (url.pathname === '/') {
          await bot.setMyCommands([
            { command: 'start', description: 'Start the bot' },
            { command: 'about', description: 'About this bot' },
            { command: 'faq', description: 'Frequently Asked Questions' },
            { command: 'disclaimer', description: 'Legal Disclaimer' },
          ]);
          const webhookUrl = `${url.origin}/`;
          const result = await bot.setWebhook(webhookUrl, { drop_pending_updates: true });
          return new Response(`✅ Webhook set to ${webhookUrl}.\nResult: ${JSON.stringify(result)}`);
        }
        if (url.pathname === '/delete') {
          const result = await bot.deleteWebhook();
          return new Response(`✅ Webhook deleted.\nResult: ${JSON.stringify(result)}`);
        }
        if (url.pathname === '/status') {
          const info = await bot.getWebhookInfo();
          return new Response(JSON.stringify(info, null, 2), { headers: { 'Content-Type': 'application/json' }});
        }
      }
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('fetch handler error', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

/* -------------------- Helpers & Handlers -------------------- */

async function handleUpdate(bot, update, env) {
  try {
    if (update.message) {
      await handleMessage(bot, update.message, env);
    } else if (update.callback_query) {
      await handleCallback(bot, update.callback_query, env);
    } else {
      console.warn('Unhandled update type', update);
    }
  } catch (err) {
    console.error('handleUpdate error', err);
  }
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMainCaption(data) {
  try {
    const title = `<b>${escapeHtml(data.title || 'Unknown Title')}</b>`;
    const year = data.year ? ` (${escapeHtml(String(data.year))})` : '';
    const tagline = data.tagline ? `\n<i>${escapeHtml(data.tagline)}</i>\n` : '\n';
    const plot = data.plot ? `<em>${escapeHtml((data.plot || '').substring(0, 700))}</em>` : '<i>No summary available.</i>';
    const rating = data.rating ? `<b>⭐ ${escapeHtml(String(data.rating))}</b>` : '<b>⭐ N/A</b>';
    const runtime = data.runtime ? `• ${escapeHtml(String(data.runtime))} min` : '';
    const genres = data.genres ? `<u>${escapeHtml(data.genres)}</u>` : '<u>N/A</u>';
    const tmdbUrl = data.url ? `<a href="${escapeHtml(data.url)}">View on TMDB</a>` : '';

    return `${title}${year}\n${tagline}\n${plot}\n\n${rating} ${runtime} • ${genres}\n\n${tmdbUrl}`;
  } catch (err) {
    console.error('formatMainCaption error', err);
    return `<b>${escapeHtml((data && data.title) || 'Unknown')}</b>`;
  }
}

function buildMainKeyboard(data) {
  try {
    const mediaId = data.media_id;
    const posterBtn = { text: '🖼️ View Posters', callback_data: `view:posters:en:0:${mediaId}` };
    const backdropBtn = { text: '🏞️ View Backdrops', callback_data: `view:backdrops:en:0:${mediaId}` };
    const detailsBtn = { text: 'ℹ️ Full Details', callback_data: `details:${mediaId}` };
    const shareBtn = { text: '🔁 Share', switch_inline_query: `${data.title || ''}` };
    const openBtn = data.url ? { text: 'Open TMDB', url: data.url } : null;

    const row1 = [posterBtn, backdropBtn];
    const row2 = [detailsBtn];
    const row3 = openBtn ? [openBtn, shareBtn] : [shareBtn];

    return { inline_keyboard: [row1, row2, row3] };
  } catch (err) {
    console.error('buildMainKeyboard error', err);
    return { inline_keyboard: [] };
  }
}

// answer callback safely
async function safeAnswerCallback(bot, callback_query_id, opts = {}) {
  try {
    await bot.answerCallbackQuery(callback_query_id, opts);
  } catch (err) {
    console.warn('answerCallbackQuery failed', err);
  }
}

async function handleMessage(bot, message, env) {
  const chat_id = message.chat.id;
  const text = (message.text || '').trim();

  try {
    if (text.startsWith('/')) {
      const command = text.split(' ')[0].toLowerCase();
      if (command === '/start') return bot.sendMessage(chat_id, `<b>Welcome to PosterFlix</b>\nSend a movie or TV show name to begin.\n\n<i>Example:</i> <code>The Matrix 1999</code>`, { parse_mode: PARSE_MODE });
      if (command === '/about') return bot.sendMessage(chat_id, ABOUT_TEXT, { parse_mode: PARSE_MODE });
      if (command === '/faq') return bot.sendMessage(chat_id, FAQ_TEXT, { parse_mode: PARSE_MODE });
      if (command === '/disclaimer') return bot.sendMessage(chat_id, DISCLAIMER_TEXT, { parse_mode: PARSE_MODE });
    }

    if (!text) return;

    if (!/\d{4}/.test(text)) {
      await bot.sendMessage(chat_id, `<b>⚠️ Tip</b> — For the most accurate results, include the year in your search.\n<i>Example:</i> <code>Inception 2010</code>`, { parse_mode: PARSE_MODE });
    }

    const apiUrl = `https://tmdbapi-eight.vercel.app/api/movie-posters?query=${encodeURIComponent(text)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        await bot.sendMessage(chat_id, `<b>😕 No results</b> — Couldn't find results for <code>${escapeHtml(text)}</code>. Please check spelling or add a year.`, { parse_mode: PARSE_MODE });
        return;
      }

      const data = await response.json();
      if (!data || !data.media_id) {
        await bot.sendMessage(chat_id, `<b>🔍 No usable result</b> — The search completed but returned incomplete data. Try a different query.`, { parse_mode: PARSE_MODE });
        return;
      }

      // Cache the result for callbacks
      await env.BOT_STATE.put(`media:${data.media_id}`, JSON.stringify(data), { expirationTtl: CACHE_TTL });

      // default language
      const defaultLang = (data.images?.posters && data.images.posters.en && 'en') ||
                          (data.images?.backdrops && data.images.backdrops.en && 'en') ||
                          (Object.keys(data.images?.posters || {})[0] || Object.keys(data.images?.backdrops || {})[0] || 'all');

      // Show main menu (photo) first
      await sendMainMenu(bot, chat_id, data);

    } catch (err) {
      console.error('handleMessage -> fetch/search error', err);
      const reason = err.name === 'AbortError' ? 'request timeout' : escapeHtml(String(err.message || err));
      await bot.sendMessage(chat_id, `<b>⚠️ Error</b> — Could not perform search: <code>${reason}</code>`, { parse_mode: PARSE_MODE });
    }
  } catch (err) {
    console.error('handleMessage error', err);
  }
}

async function handleCallback(bot, callbackQuery, env) {
  const cb_id = callbackQuery.id;
  const parts = (callbackQuery.data || '').split(':');
  const action = parts[0];

  // ack quickly to avoid unresponsive buttons
  await safeAnswerCallback(bot, cb_id).catch(() => {});

  if (!callbackQuery || !callbackQuery.data) {
    console.warn('Empty callback query or data', callbackQuery);
    return;
  }

  try {
    switch (action) {
      case 'view': {
        const [, media_type, lang, pageStr, media_id] = parts;
        const page = Math.max(0, parseInt(pageStr, 10) || 0);
        const dataStr = await env.BOT_STATE.get(`media:${media_id}`);
        if (!dataStr) {
          await safeAnswerCallback(bot, cb_id, { text: 'Session expired. Please search again.', show_alert: true });
          return;
        }
        const data = JSON.parse(dataStr);
        await sendResultsGrid(bot, callbackQuery.message.chat.id, data, media_type, lang, page, callbackQuery.message.message_id, callbackQuery.message);
        break;
      }

      case 'page': {
        const [, media_type, lang, pageStr, media_id] = parts;
        const page = Math.max(0, parseInt(pageStr, 10) || 0);
        const dataStr = await env.BOT_STATE.get(`media:${media_id}`);
        if (!dataStr) {
          await safeAnswerCallback(bot, cb_id, { text: 'Session expired. Please search again.', show_alert: true });
          return;
        }
        const data = JSON.parse(dataStr);
        await sendResultsGrid(bot, callbackQuery.message.chat.id, data, media_type, lang, page, callbackQuery.message.message_id, callbackQuery.message);
        break;
      }

      case 'pick': {
        const [, media_type, lang, indexStr, media_id] = parts;
        const index = parseInt(indexStr, 10) || 0;
        const dataStr = await env.BOT_STATE.get(`media:${media_id}`);
        if (!dataStr) {
          await safeAnswerCallback(bot, cb_id, { text: 'Session expired. Please search again.', show_alert: true });
          return;
        }
        const data = JSON.parse(dataStr);
        await showImagePreview(bot, callbackQuery.message.chat.id, data, media_type, lang, index, callbackQuery.message.message_id, callbackQuery.message);
        break;
      }

      case 'send': {
        const [, media_type, lang, indexStr, media_id] = parts;
        const index = parseInt(indexStr, 10) || 0;
        const dataStr = await env.BOT_STATE.get(`media:${media_id}`);
        if (!dataStr) {
          await safeAnswerCallback(bot, cb_id, { text: 'Session expired. Please search again.', show_alert: true });
          return;
        }
        const data = JSON.parse(dataStr);
        const image = (data.images?.[media_type]?.[lang] || [])[index];
        if (!image) {
          await safeAnswerCallback(bot, cb_id, { text: 'Image not found.', show_alert: true });
          return;
        }
        try {
          await bot.sendPhoto(callbackQuery.message.chat.id, image, { caption: `<b>${escapeHtml(data.title || '')}</b> — <i>${escapeHtml(media_type)}</i>`, parse_mode: PARSE_MODE });
          await safeAnswerCallback(bot, cb_id, { text: 'Poster sent.' });
        } catch (err) {
          console.error('send photo error', err);
          await safeAnswerCallback(bot, cb_id, { text: 'Failed to send photo.', show_alert: true });
        }
        break;
      }

      case 'langs': {
        const [, media_type, media_id] = parts;
        const dataStr = await env.BOT_STATE.get(`media:${media_id}`);
        if (!dataStr) {
          await safeAnswerCallback(bot, cb_id, { text: 'Session expired. Please search again.', show_alert: true });
          return;
        }
        const data = JSON.parse(dataStr);

        // Build buttons showing language + count: "EN (12)"
        const langs = Object.keys(data.images?.[media_type] || {});
        const buttons = langs.sort().map(langKey => {
          const count = (data.images?.[media_type]?.[langKey] || []).length;
          const label = `${langKey === 'all' ? 'All' : (langKey.length === 2 ? langKey.toUpperCase() : langKey)} (${count})`;
          return [{ text: label, callback_data: `view:${media_type}:${langKey}:0:${media_id}` }];
        });

        // fallback back button
        buttons.push([{ text: '« Back', callback_data: `view:${media_type}:en:0:${media_id}` }]);

        try {
          // if original message is photo -> delete it then send a new message with caption+languages (so preview can be added if you want)
          if (callbackQuery.message && callbackQuery.message.photo) {
            try {
              // delete the photo message to avoid the old image sticking around
              await bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
            } catch (delErr) {
              console.warn('Could not delete original photo message before showing languages', delErr);
            }
            // send a new message listing languages (use LinkPreviewOptions only if you want a preview image here; no image needed)
            await bot.sendMessage(callbackQuery.message.chat.id, `<b>Select language</b>`, { parse_mode: PARSE_MODE, reply_markup: { inline_keyboard: buttons } });
            await safeAnswerCallback(bot, cb_id);
          } else {
            // if not a photo, edit the message text
            try {
              await bot.editMessageText(callbackQuery.message.chat.id, callbackQuery.message.message_id, `<b>Select language</b>`, { parse_mode: PARSE_MODE, reply_markup: { inline_keyboard: buttons } });
              await safeAnswerCallback(bot, cb_id);
            } catch (err) {
              console.warn('editMessageText for langs failed, sending new message', err);
              await bot.sendMessage(callbackQuery.message.chat.id, `<b>Select language</b>`, { parse_mode: PARSE_MODE, reply_markup: { inline_keyboard: buttons } });
              await safeAnswerCallback(bot, cb_id);
            }
          }
        } catch (err) {
          console.error('langs -> send/edit failed', err);
          await safeAnswerCallback(bot, cb_id, { text: 'Could not show languages.', show_alert: true });
        }
        break;
      }

      case 'back': {
        const [, , media_id] = parts;
        const dataStr = await env.BOT_STATE.get(`media:${media_id}`);
        if (!dataStr) {
          await safeAnswerCallback(bot, cb_id, { text: 'Session expired. Please search again.', show_alert: true });
          return;
        }
        const data = JSON.parse(dataStr);
        await sendMainMenu(bot, callbackQuery.message.chat.id, data, callbackQuery.message.message_id);
        break;
      }

      case 'noop':
      default:
        // already acked
        break;
    }
  } catch (err) {
    console.error('handleCallback error', err);
    try { await safeAnswerCallback(bot, cb_id, { text: 'An internal error occurred.', show_alert: true }); } catch (_) {}
  }
}

function paginateArray(arr = [], pageSize = GRID_PAGE_SIZE) {
  const pages = [];
  for (let i = 0; i < arr.length; i += pageSize) pages.push(arr.slice(i, i + pageSize));
  return pages;
}

function buildGridKeyboard(totalItems, pageIndex, pageSize, media_type, lang, media_id) {
  try {
    const start = pageIndex * pageSize;
    const end = Math.min(start + pageSize, totalItems);
    const rows = [];
    let row = [];
    for (let i = start; i < end; i++) {
      const label = `${i + 1}`;
      row.push({ text: label, callback_data: `pick:${media_type}:${lang}:${i}:${media_id}` });
      if (row.length === GRID_COLS) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) rows.push(row);

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const navRow = [];
    if (pageIndex > 0) navRow.push({ text: '◀ Prev', callback_data: `page:${media_type}:${lang}:${pageIndex - 1}:${media_id}` });
    navRow.push({ text: `Page ${pageIndex + 1}/${totalPages}`, callback_data: 'noop' });
    if (pageIndex < totalPages - 1) navRow.push({ text: 'Next ▶', callback_data: `page:${media_type}:${lang}:${pageIndex + 1}:${media_id}` });

    const actionRow = [
      { text: '🌐 Languages', callback_data: `langs:${media_type}:${media_id}` },
      { text: '🔁 Share', switch_inline_query: '' },
      { text: '❌ Close', callback_data: `back:main:${media_id}` }
    ];

    rows.push(navRow);
    rows.push(actionRow);
    return { inline_keyboard: rows };
  } catch (err) {
    console.error('buildGridKeyboard error', err);
    return { inline_keyboard: [] };
  }
}

/* -------------------- Results & Preview behavior -------------------- */

// When original message is a photo, deleting it then sending a new text message ensures the preview (LinkPreviewOptions)
// can be shown above the text. We delete only when necessary and swallow delete errors (best-effort).
// Replace the sendResultsGrid function in src/index.js with this one:
async function sendResultsGrid(bot, chat_id, data, media_type = 'posters', lang = 'en', pageIndex = 0, message_id = null, origMessage = null) {
  try {
    const imageList = (data.images?.[media_type]?.[lang]) || [];
    const total = imageList.length;

    if (total === 0) {
      const altLangs = Object.keys(data.images?.[media_type] || {});
      if (altLangs.length > 0 && altLangs[0] !== lang) {
        return sendResultsGrid(bot, chat_id, data, media_type, altLangs[0], 0, message_id, origMessage);
      }
      const caption = `<b>${escapeHtml(data.title || '')}</b> — <i>No ${escapeHtml(media_type)} found</i>`;
      if (message_id && origMessage && origMessage.photo) {
        try { return await bot.editMessageCaption(chat_id, message_id, caption, { parse_mode: PARSE_MODE }); } catch (_) {}
      }
      if (message_id) {
        try { return await bot.editMessageText(chat_id, message_id, caption, { parse_mode: PARSE_MODE }); } catch (_) {}
      }
      return bot.sendMessage(chat_id, caption, { parse_mode: PARSE_MODE });
    }

    const pages = paginateArray(imageList, GRID_PAGE_SIZE);
    const idxPage = Math.max(0, Math.min(pageIndex, pages.length - 1));
    const sampleImage = pages[idxPage][0] || data.poster_url || PLACEHOLDER_POSTER;

    const caption = `<b>${escapeHtml(data.title || '')}</b> — <i>${escapeHtml(media_type)}</i>\n<b>Showing</b>: ${idxPage * GRID_PAGE_SIZE + 1} - ${Math.min((idxPage + 1) * GRID_PAGE_SIZE, imageList.length)} of ${imageList.length}`;
    const keyboard = buildGridKeyboard(imageList.length, idxPage, GRID_PAGE_SIZE, media_type, lang, data.media_id);

    const LinkPreviewOptions = {
      is_disabled: false,
      url: sampleImage,
      prefer_large_media: true,
      show_above_text: true,
    };

    if (message_id && origMessage && origMessage.photo) {
      try {
        await bot.deleteMessage(origMessage.chat.id, origMessage.message_id);
      } catch (delErr) {
        console.warn('delete original photo failed (continuing)', delErr);
      }
      try {
        await bot.sendMessage(chat_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard, link_preview_options: LinkPreviewOptions });
        return;
      } catch (err) {
        console.warn('sendMessage with LinkPreviewOptions failed, sending without preview', err);
        await bot.sendMessage(chat_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard });
        return;
      }
    }

    if (message_id) {
      try {
        await bot.editMessageText(chat_id, message_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard, link_preview_options: LinkPreviewOptions });
        return;
      } catch (err) {
        console.warn('editMessageText failed, falling back to sendMessage', err);
      }
    }

    try {
      await bot.sendMessage(chat_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard, link_preview_options: LinkPreviewOptions });
    } catch (err) {
      console.warn('sendMessage (grid) failed, fallback to send caption without preview', err);
      await bot.sendMessage(chat_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard });
    }
  } catch (err) {
    console.error('sendResultsGrid error', err);
  }
}


// Replace the showImagePreview function in src/index.js with this one:
async function showImagePreview(bot, chat_id, data, media_type, lang, index, message_id = null, origMessage = null) {
  try {
    const image = (data.images?.[media_type]?.[lang] || [])[index];
    if (!image) {
      const txt = `<b>Image not found</b>`;
      if (message_id && origMessage && origMessage.photo) return bot.editMessageCaption(chat_id, message_id, txt, { parse_mode: PARSE_MODE });
      if (message_id) return bot.editMessageText(chat_id, message_id, txt, { parse_mode: PARSE_MODE });
      return bot.sendMessage(chat_id, txt, { parse_mode: PARSE_MODE });
    }

    const caption = `<b>${escapeHtml(data.title || '')}</b> — <i>${escapeHtml(media_type)}</i>\n<code>Image ${index + 1}</code>`;
    const keyboard = { inline_keyboard: [[
      { text: '📩 Send Poster', callback_data: `send:${media_type}:${lang}:${index}:${data.media_id}` },
      { text: '🔙 Back to Results', callback_data: `view:${media_type}:${lang}:${Math.floor(index / GRID_PAGE_SIZE)}:${data.media_id}` }
    ], [ { text: '🌐 Languages', callback_data: `langs:${media_type}:${data.media_id}` }, { text: '❌ Close', callback_data: `back:main:${data.media_id}` } ]] };

    const LinkPreviewOptions = {
      is_disabled: false,
      url: image,
      prefer_large_media: true,
      show_above_text: true,
    };

    if (message_id && origMessage && origMessage.photo) {
      try {
        await bot.deleteMessage(origMessage.chat.id, origMessage.message_id);
      } catch (delErr) {
        console.warn('delete original photo before preview failed', delErr);
      }
      try {
        await bot.sendMessage(chat_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard, link_preview_options: LinkPreviewOptions });
        return;
      } catch (err) {
        console.warn('sendMessage (preview with LinkPreviewOptions) failed, fallback to sendPhoto', err);
        await bot.sendPhoto(chat_id, image, { caption: caption, parse_mode: PARSE_MODE, reply_markup: keyboard });
        return;
      }
    }

    if (message_id) {
      try {
        await bot.editMessageText(chat_id, message_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard, link_preview_options: LinkPreviewOptions });
        return;
      } catch (err) {
        console.warn('editMessageText preview failed, falling back to sendMessage', err);
      }
    }

    try {
      await bot.sendMessage(chat_id, caption, { parse_mode: PARSE_MODE, reply_markup: keyboard, link_preview_options: LinkPreviewOptions });
    } catch (err) {
      console.warn('sendMessage preview failed, fallback to sendPhoto', err);
      await bot.sendPhoto(chat_id, image, { caption: caption, parse_mode: PARSE_MODE, reply_markup: keyboard });
    }
  } catch (err) {
    console.error('showImagePreview error', err);
  }
}
async function sendMainMenu(bot, chat_id, data, message_id = null) {
  try {
    const caption = formatMainCaption(data);
    const keyboard = buildMainKeyboard(data);
    const media = data.poster_url || PLACEHOLDER_POSTER;

    if (message_id) {
      try {
        await bot.editMessageMedia(chat_id, message_id, { type: 'photo', media: media, caption: caption, parse_mode: PARSE_MODE }, { reply_markup: keyboard });
        return;
      } catch (err) {
        console.warn('editMessageMedia failed in sendMainMenu, will try to send new', err);
      }
    }

    await bot.sendPhoto(chat_id, media, { caption: caption, parse_mode: PARSE_MODE, reply_markup: keyboard });
  } catch (err) {
    console.error('sendMainMenu failed', err);
    try { await bot.sendMessage(chat_id, formatMainCaption(data) + '\n\n(Note: could not show poster image.)', { parse_mode: PARSE_MODE }); } catch (e) { console.error('fallback sendMainMenu failed', e); }
  }
}

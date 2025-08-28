// src/index.js

import { TelegramBot } from "./telegram";

// --- GLOBAL CONFIG ---
const PARSE_MODE = "HTML";
const PLACEHOLDER_POSTER =
    "https://iili.io/K3MHOWg.png";
const START_IMG = "https://iili.io/K3EPnKg.md.jpg";
const UPDATE_CHANNEL = "https://t.me/Blaze_Updatez";
const CACHE_TTL = 60 * 60 * 2; // 2 hours
const GRID_PAGE_SIZE = 20;
const GRID_COLS = 5;

// --- Static Content (HTML formatted) ---
const ABOUT_TEXT = `<b>About PosterFlix</b>\n\nThis bot helps you preview and download official movie & TV posters and backdrops from The Movie Database (TMDB).\n\n<b>Features</b>\n• High-resolution image access\n• Multi-language support\n• Smart search with year hints`;
const FAQ_TEXT = `<b>Frequently Asked Questions</b>\n\n<b>Q: Do you host any images?</b>\nA: No — images are linked directly from TMDB in real time.\n\n<b>Q: Is this bot affiliated with TMDB?</b>\nA: No. This is an independent project using TMDB's public API.`;
const DISCLAIMER_TEXT = `<b>Legal Disclaimer</b>\n\nThis bot uses the TMDB API and is not endorsed by TMDB. All images and copyrights belong to their respective owners. Use for personal, non-commercial purposes only.`;

// --- Utility Functions ---
function escapeHtml(text = "") {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function validateYearInQuery(text) {
    return /\d{4}/.test(text);
}

function getMediaCacheKey(mediaId) {
    return `media:${mediaId}`;
}

function parseCallbackData(data) {
    if (!data) return { action: "noop", params: [] };

    const [action, ...params] = data.split(":");
    return { action, params };
}

function formatBoxOffice(amount) {
    if (!amount) return "";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
    }).format(amount);
}

function buildGridKeyboard(
    totalItems,
    pageIndex,
    pageSize,
    mediaType,
    lang,
    mediaId,
    activeIndex,
    cols = GRID_COLS
) {
    const start = pageIndex * pageSize;
    const end = Math.min(start + pageSize, totalItems);
    const rows = [];
    let row = [];

    for (let i = start; i < end; i++) {
        const label = i === activeIndex ? `◉ ${i + 1} ◉` : `${i + 1}`;
        row.push({
            text: label,
            callback_data: `pick:${mediaType}:${lang}:${i}:${mediaId}`,
        });

        if (row.length === cols) {
            rows.push(row);
            row = [];
        }
    }

    if (row.length) rows.push(row);

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const navRow = [];

    if (pageIndex > 0) {
        navRow.push({
            text: "◀ Prev",
            callback_data: `page:${mediaType}:${lang}:${pageIndex - 1}:${mediaId}`,
        });
    }

    navRow.push({
        text: `Page ${pageIndex + 1}/${totalPages}`,
        callback_data: "noop",
    });

    if (pageIndex < totalPages - 1) {
        navRow.push({
            text: "Next ▶",
            callback_data: `page:${mediaType}:${lang}:${pageIndex + 1}:${mediaId}`,
        });
    }

    rows.push(navRow);

    const actionRow = [
        {
            text: "📩 Send To Me",
            callback_data: `send:${mediaType}:${lang}:${activeIndex}:${mediaId}`,
        },
        { text: "🌐 Languages", callback_data: `langs:${mediaType}:${mediaId}` },
        { text: "« Back", callback_data: `back:main:${mediaId}` },
    ];

    rows.push(actionRow);

    return { inline_keyboard: rows };
}

// --- Message Sending Functions ---
async function sendMainMenu(bot, chatId, data, messageId = null) {
    const caption = `<b>${escapeHtml(data.title || "Unknown Title")}</b> (${data.year || "N/A"
        })\n\n<i>${escapeHtml(data.plot || "No summary available.").substring(
            0,
            700
        )}</i>`;

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: "🖼️ View Posters",
                    callback_data: `view:posters:en:0:${data.media_id}`,
                },
                {
                    text: "🏞️ View Backdrops",
                    callback_data: `view:backdrops:en:0:${data.media_id}`,
                },
            ],
            [{ text: "ℹ️ More Info", callback_data: `details:${data.media_id}` }],
            [{ text: "❌ Close", callback_data: `close` }],
        ],
    };

    const previewUrl =
        data.images?.backdrops?.en?.[0] || data.poster_url || PLACEHOLDER_POSTER;
    const link_preview_options = {
        is_disabled: false,
        url: previewUrl,
        prefer_large_media: true,
        show_above_text: true,
    };

    if (messageId) {
        await bot.editMessageText(chatId, messageId, caption, {
            parse_mode: PARSE_MODE,
            reply_markup: keyboard,
            link_preview_options,
        });
    } else {
        await bot.sendMessage(chatId, caption, {
            parse_mode: PARSE_MODE,
            reply_markup: keyboard,
            link_preview_options,
        });
    }
}

async function sendResultsGrid(
    bot,
    chatId,
    data,
    mediaType,
    lang,
    pageIndex,
    messageId,
    activeIndex = -1
) {
    const imageList = data.images?.[mediaType]?.[lang] || [];
    const total = imageList.length;

    if (total === 0) {
        return bot.editMessageText(
            chatId,
            messageId,
            `<b>${escapeHtml(data.title)}</b>\n\n<i>No ${escapeHtml(
                mediaType
            )} found for this language.</i>`,
            {
                parse_mode: PARSE_MODE,
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "🌐 Change Language",
                                callback_data: `langs:${mediaType}:${data.media_id}`,
                            },
                            { text: "« Back", callback_data: `back:main:${data.media_id}` },
                        ],
                    ],
                },
            }
        );
    }

    const page = Math.max(
        0,
        Math.min(pageIndex, Math.ceil(total / GRID_PAGE_SIZE) - 1)
    );
    if (activeIndex === -1) {
        activeIndex = page * GRID_PAGE_SIZE;
    }
    activeIndex = Math.max(0, Math.min(activeIndex, total - 1));

    const previewImage =
        imageList[activeIndex] || imageList[0] || PLACEHOLDER_POSTER;
    const caption = `<b>${escapeHtml(data.title)}</b> — <i>${escapeHtml(
        mediaType
    )} (${lang.toUpperCase()})</i>\nPreviewing image ${activeIndex + 1
        }/${total}. Select a number to change the preview.`;
    const keyboard = buildGridKeyboard(
        total,
        page,
        GRID_PAGE_SIZE,
        mediaType,
        lang,
        data.media_id,
        activeIndex
    );
    const link_preview_options = {
        is_disabled: false,
        url: previewImage,
        prefer_large_media: true,
        show_above_text: true,
    };

    await bot.editMessageText(chatId, messageId, caption, {
        parse_mode: PARSE_MODE,
        reply_markup: keyboard,
        link_preview_options,
    });
}

async function sendDetailsPage(bot, chatId, data, messageId) {
    const title = `<b>${escapeHtml(data.title || "Unknown Title")}</b> (${data.year || "N/A"
        })`;
    const tagline = data.tagline ? `\n<i>${escapeHtml(data.tagline)}</i>` : "";

    let details = ``;
    if (data.rating)
        details += `\n<b>Rating:</b> ⭐ ${escapeHtml(String(data.rating))}`;
    if (data.runtime) details += ` | <b>Runtime:</b> ${escapeHtml(data.runtime)}`;
    if (data.genres) details += `\n<b>Genres:</b> ${escapeHtml(data.genres)}`;
    if (data.director)
        details += `\n<b>Director:</b> ${escapeHtml(data.director)}`;
    if (data.writer) details += `\n<b>Writer:</b> ${escapeHtml(data.writer)}`;
    if (data.cast)
        details += `\n<b>Cast:</b> <i>${escapeHtml(
            data.cast.split(", ").slice(0, 5).join(", ")
        )}...</i>`;
    if (data.countries)
        details += `\n<b>Country:</b> ${escapeHtml(data.countries)}`;
    if (data.languages)
        details += `\n<b>Languages:</b> ${escapeHtml(data.languages)}`;
    if (data.box_office) {
        const formattedBoxOffice = formatBoxOffice(data.box_office);
        details += `\n<b>Box Office:</b> ${escapeHtml(formattedBoxOffice)}`;
    }

    const text = `${title}${tagline}\n${details}`;

    const imdbUrl = data.imdb_id
        ? `https://www.imdb.com/title/${data.imdb_id}/`
        : null;
    const tmdbUrl = data.url;

    const buttonRow = [];
    if (imdbUrl) buttonRow.push({ text: "Open IMDb", url: imdbUrl });
    if (tmdbUrl) buttonRow.push({ text: "Open TMDB", url: tmdbUrl });

    const keyboard = {
        inline_keyboard: [
            buttonRow,
            [{ text: "« Back", callback_data: `back:main:${data.media_id}` }],
        ],
    };

    const previewUrl =
        data.images?.backdrops?.en?.[0] || data.poster_url || PLACEHOLDER_POSTER;
    const link_preview_options = {
        is_disabled: false,
        url: previewUrl,
        prefer_large_media: true,
        show_above_text: true,
    };

    await bot.editMessageText(chatId, messageId, text, {
        parse_mode: PARSE_MODE,
        reply_markup: keyboard,
        link_preview_options,
    });
}

async function sendLanguageSelection(bot, message, mediaData, mediaType) {
    const langs = Object.keys(mediaData.images?.[mediaType] || {});
    const buttons = langs.sort().map((langKey) => {
        const count = (mediaData.images?.[mediaType]?.[langKey] || []).length;
        const label = `${langKey === "all"
                ? "All"
                : langKey.length === 2
                    ? langKey.toUpperCase()
                    : langKey
            } (${count})`;
        return [
            {
                text: label,
                callback_data: `view:${mediaType}:${langKey}:0:${mediaData.media_id}`,
            },
        ];
    });

    buttons.push([
        {
            text: "« Back to Grid",
            callback_data: `view:${mediaType}:en:0:${mediaData.media_id}`,
        },
    ]);

    await bot.editMessageText(
        message.chat.id,
        message.message_id,
        `<b>Select Language</b> for ${escapeHtml(mediaType)}`,
        {
            parse_mode: PARSE_MODE,
            reply_markup: { inline_keyboard: buttons },
        }
    );
}

// --- Handler Functions ---
async function handleMessage(bot, message, env) {
    const chatId = message.chat.id;
    const text = (message.text || "").trim();

    try {
        if (text.startsWith("/")) {
            const command = text.split(" ")[0].toLowerCase();
            const buttons = [
                [{ text: "Update Channel", url: UPDATE_CHANNEL }],
            ];
            if (command === "/start")
                return bot.sendMessage(
                    chatId,
                    `<blockquote><b>Welcome to PosterFlix</b>\nSend a movie or TV show name to begin.\n\n<i>Example:</i> <code>The Matrix 1999</code></blockquote>`,
                    {
                        parse_mode: PARSE_MODE,
                        link_preview_options: {
                            is_disabled: false,
                            url: START_IMG,
                            prefer_small_media: false,
                            prefer_large_media: true,
                            show_above_text: true,
                        },
                        reply_markup: {
                            inline_keyboard: buttons,
                        },
                    }
                );
            if (command === "/about")
                return bot.sendMessage(chatId, ABOUT_TEXT, { parse_mode: PARSE_MODE });
            if (command === "/faq")
                return bot.sendMessage(chatId, FAQ_TEXT, { parse_mode: PARSE_MODE });
            if (command === "/disclaimer")
                return bot.sendMessage(chatId, DISCLAIMER_TEXT, {
                    parse_mode: PARSE_MODE,
                });
        }

        if (!text) return;

        if (!validateYearInQuery(text)) {
            await bot.sendMessage(
                chatId,
                `<b>⚠️ Tip</b> — For the most accurate results, include the year in your search.\n<i>Example:</i> <code>Inception 2010</code>`,
                { parse_mode: PARSE_MODE }
            );
        }

        const apiUrl = `https://tmdbapi-eight.vercel.app/api/movie-posters?query=${encodeURIComponent(
            text
        )}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
            return bot.sendMessage(
                chatId,
                `<b>😕 No results</b> — Couldn't find results for <code>${escapeHtml(
                    text
                )}</code>. Please check spelling or add a year.`,
                { parse_mode: PARSE_MODE }
            );
        }

        const data = await response.json();
        if (!data || !data.media_id) {
            return bot.sendMessage(
                chatId,
                `<b>🔍 No usable result</b> — The search completed but returned incomplete data. Try a different query.`,
                { parse_mode: PARSE_MODE }
            );
        }

        await env.BOT_STATE.put(
            getMediaCacheKey(data.media_id),
            JSON.stringify(data),
            { expirationTtl: CACHE_TTL }
        );
        await sendMainMenu(bot, chatId, data);
    } catch (err) {
        console.error("handleMessage error", err);
        await bot.sendMessage(
            chatId,
            `<b>⚠️ Error</b> — Could not perform search: <code>${escapeHtml(
                String(err.message || err)
            )}</code>`,
            { parse_mode: PARSE_MODE }
        );
    }
}

async function handleCallback(bot, callbackQuery, env) {
    const cb_id = callbackQuery.id;
    const { action, params } = parseCallbackData(callbackQuery.data);

    await bot.answerCallbackQuery(cb_id).catch(() => { });

    if (action === "noop") return;

    try {
        const message = callbackQuery.message;

        if (action === "close") {
            return bot.deleteMessage(message.chat.id, message.message_id);
        }

        const media_id = params[params.length - 1];
        const dataStr = await env.BOT_STATE.get(getMediaCacheKey(media_id));
        if (!dataStr) {
            return bot.answerCallbackQuery(cb_id, {
                text: "Session expired. Please search again.",
                show_alert: true,
            });
        }
        const data = JSON.parse(dataStr);

        switch (action) {
            case "view": {
                const [media_type, lang, pageStr] = params;
                const page = parseInt(pageStr, 10) || 0;
                await sendResultsGrid(
                    bot,
                    message.chat.id,
                    data,
                    media_type,
                    lang,
                    page,
                    message.message_id
                );
                break;
            }
            case "page": {
                const [media_type, lang, pageStr] = params;
                await sendResultsGrid(
                    bot,
                    message.chat.id,
                    data,
                    media_type,
                    lang,
                    parseInt(pageStr, 10),
                    message.message_id
                );
                break;
            }
            case "pick": {
                const [media_type, lang, indexStr] = params;
                const activeIndex = parseInt(indexStr, 10);
                const pageIndex = Math.floor(activeIndex / GRID_PAGE_SIZE);
                await sendResultsGrid(
                    bot,
                    message.chat.id,
                    data,
                    media_type,
                    lang,
                    pageIndex,
                    message.message_id,
                    activeIndex
                );
                break;
            }
            case "send": {
                const [media_type, lang, indexStr] = params;
                const index = parseInt(indexStr, 10);
                const image = (data.images?.[media_type]?.[lang] || [])[index];
                if (image) {
                    const lang_name =
                        lang.length === 2 ? lang.toUpperCase() : "N/A";
                    const caption = `<a href="${image}"><b>${escapeHtml(
                        data.title || ""
                    )}</b></a> | <a href="${UPDATE_CHANNEL}"><b>Join</b></a>\n<i>${escapeHtml(
                        media_type
                    )} | Language: ${lang_name} | Image #${index + 1}</i>`;
                    await bot.sendPhoto(message.chat.id, image, {
                        caption: caption,
                        parse_mode: PARSE_MODE,
                    });
                }
                break;
            }
            case "langs": {
                const [media_type] = params;
                await sendLanguageSelection(bot, message, data, media_type);
                break;
            }
            case "details": {
                await sendDetailsPage(bot, message.chat.id, data, message.message_id);
                break;
            }
            case "back": {
                await sendMainMenu(bot, message.chat.id, data, message.message_id);
                break;
            }
        }
    } catch (err) {
        console.error("handleCallback error", err);
    }
}

async function handleUpdate(bot, update, env) {
    try {
        if (update.message) {
            await handleMessage(bot, update.message, env);
        } else if (update.callback_query) {
            await handleCallback(bot, update.callback_query, env);
        }
    } catch (err) {
        console.error("handleUpdate error", err);
    }
}

// --- Main Export ---
export default {
    async fetch(request, env, ctx) {
        const bot = new TelegramBot(env.BOT_TOKEN, env);
        const url = new URL(request.url);

        try {
            if (request.method === "POST") {
                const update = await request.json();
                await handleUpdate(bot, update, env);
                return new Response("ok");
            }

            if (request.method === "GET") {
                if (url.pathname === "/") {
                    await bot.setMyCommands([
                        { command: "start", description: "Start the bot" },
                        { command: "about", description: "About this bot" },
                        { command: "faq", description: "Frequently Asked Questions" },
                        { command: "disclaimer", description: "Legal Disclaimer" },
                    ]);
                    const webhookUrl = `${url.origin}/`;
                    const result = await bot.setWebhook(webhookUrl, {
                        drop_pending_updates: true,
                    });
                    return new Response(
                        `✅ Webhook set to ${webhookUrl}.\nResult: ${JSON.stringify(
                            result
                        )}`
                    );
                }
                if (url.pathname === "/delete") {
                    const result = await bot.deleteWebhook();
                    return new Response(
                        `✅ Webhook deleted.\nResult: ${JSON.stringify(result)}`
                    );
                }
                if (url.pathname === "/status") {
                    const info = await bot.getWebhookInfo();
                    return new Response(JSON.stringify(info, null, 2), {
                        headers: { "Content-Type": "application/json" },
                    });
                }
            }
            return new Response("Not Found", { status: 404 });
        } catch (err) {
            console.error("fetch handler error", err);
            return new Response("Internal Server Error", { status: 500 });
        }
    },
};

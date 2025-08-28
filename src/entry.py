# src/entry.py

import json
from workers import Request, Response, WorkerEntrypoint, fetch 
from telegram_bot import TelegramBot, Dispatcher, Message, CallbackQuery, Update

# -------------------------------------------------
# 1. Initialize Dispatcher and Define Static Content
# -------------------------------------------------
dispatcher = Dispatcher()

# Content from the HTML file's info tabs
ABOUT_TEXT = """
*About PosterFlix*

This bot allows you to preview and download official movie and TV show posters and backdrops from The Movie Database (TMDB).

Using TMDB's powerful API, PosterFlix provides lightning-fast access to high-quality artwork.

*Features include:*
• High-resolution image access
• Multi-language support
• Smart search functionality
"""

FAQ_TEXT = """
*Frequently Asked Questions*

*Q: Do you host any images?*
A: No, all images are fetched directly from TMDB's servers in real-time for maximum freshness and legal compliance.

*Q: Is this bot affiliated with TMDB?*
A: This is an independent project using TMDB's public API and is not officially endorsed by TMDB.

*Q: How often is the database updated?*
A: Data is fetched live from TMDB, ensuring you always get the latest available content.
"""

DISCLAIMER_TEXT = """
*Legal Disclaimer*

This bot uses the TMDB API but is not endorsed or certified by TMDB. All images, trademarks, and copyrighted material belong to their respective owners.

This service is designed for personal, non-commercial use only.
"""

# -------------------------------------------------
# 2. Helper Functions
# -------------------------------------------------

async def send_main_menu(bot: TelegramBot, chat_id: int, data: dict):
    """Sends the main search result message with a poster and action buttons."""
    media_id = data.get("media_id")
    plot = data.get("plot", "No summary available.")
    # Telegram captions are limited to 1024 characters
    caption = f"🎬 *{data.get('title', 'N/A')}* ({data.get('year', 'N/A')})\n\n{plot[:800]}"
    
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "🖼️ View Posters", "callback_data": f"view:posters:{media_id}"},
                {"text": "🏞️ View Backdrops", "callback_data": f"view:backdrops:{media_id}"}
            ],
            [{"text": "ℹ️ Full Details", "callback_data": f"details:{media_id}"}]
        ]
    }
    await bot.send_photo(
        chat_id,
        photo=data.get("poster_url", "https://via.placeholder.com/300x450.png?text=No+Poster"),
        options={"caption": caption, "parse_mode": "Markdown", "reply_markup": keyboard}
    )

async def handle_pagination(bot: TelegramBot, cb: CallbackQuery, env, parts: list):
    """Handles all pagination and image viewing requests."""
    try:
        _, media_type, lang, current_index_str, media_id = parts
        current_index = int(current_index_str)
        
        # Retrieve the cached data from KV
        data_str = await env.BOT_STATE.get(f"media:{media_id}")
        if not data_str:
            await bot.answer_callback_query(cb['id'], options={"text": "Sorry, this session has expired. Please search again.", "show_alert": True})
            return
        data = json.loads(data_str)
        
        image_list = data.get("images", {}).get(media_type, {}).get(lang, [])
        total_images = len(image_list)

        if not image_list:
            await bot.answer_callback_query(cb['id'], options={"text": "No images found for this selection."})
            return

        # Handle index wrapping
        new_index = max(0, min(current_index, total_images - 1))
        
        # Prepare buttons
        buttons = []
        row1 = []
        if new_index > 0:
            row1.append({"text": "⬅️ Prev", "callback_data": f"nav:{media_type}:{lang}:{new_index - 1}:{media_id}"})
        
        row1.append({"text": f"{new_index + 1}/{total_images}", "callback_data": "noop"}) # No-op button

        if new_index < total_images - 1:
            row1.append({"text": "Next ➡️", "callback_data": f"nav:{media_type}:{lang}:{new_index + 1}:{media_id}"})
        buttons.append(row1)
        
        # Add a "Back" button
        buttons.append([{"text": "« Back to Languages", "callback_data": f"view:{media_type}:{media_id}"}])
        
        # Edit the message with the new image and buttons
        media = {"type": "photo", "media": image_list[new_index]}
        await bot.edit_message_media(media=media, options={"chat_id": cb["message"]["chat"]["id"], "message_id": cb["message"]["message_id"], "reply_markup": {"inline_keyboard": buttons}})
        await bot.answer_callback_query(cb['id'])

    except Exception as e:
        await bot.answer_callback_query(cb['id'], options={"text": f"An error occurred: {e}", "show_alert": True})


# -------------------------------------------------
# 3. Bot Handlers (Dispatcher)
# -------------------------------------------------

@dispatcher.on_message()
async def handle_message(bot: TelegramBot, message: Message, env):
    """Handles incoming text messages for commands and searches."""
    chat_id = message["chat"]["id"]
    text = message.get("text", "").strip()

    # Command Handling
    if text.startswith('/'):
        if text == '/start':
            await bot.send_message(chat_id, "Welcome! Send me a movie or TV show name to get started.\n\nE.g., `The Matrix 1999`")
        elif text == '/about':
            await bot.send_message(chat_id, ABOUT_TEXT, options={"parse_mode": "Markdown"})
        elif text == '/faq':
            await bot.send_message(chat_id, FAQ_TEXT, options={"parse_mode": "Markdown"})
        elif text == '/disclaimer':
            await bot.send_message(chat_id, DISCLAIMER_TEXT, options={"parse_mode": "Markdown"})
        return

    # Search Handling
    if not text: return
    
    await bot.send_chat_action(chat_id, "typing")
    
    try:
        # The API requires a year for better accuracy
        if not any(char.isdigit() for char in text):
             await bot.send_message(chat_id, "Please include the year for better results (e.g., `Inception 2010`).")
             return

        api_url = f"https://tmdbapi-eight.vercel.app/api/movie-posters?query={text.replace(' ', '+')}"
        response = await fetch(api_url)
        
        if response.status != 200:
            await bot.send_message(chat_id, f"😕 Sorry, couldn't find anything for '{text}'. Please check the spelling and year.")
            return

        data = await response.json()
        media_id = data.get("media_id")

        if not media_id:
            await bot.send_message(chat_id, "The search was successful, but the result is missing a required ID. Please try another query.")
            return

        # Cache the result in KV for 1 hour (3600 seconds)
        await env.BOT_STATE.put(f"media:{media_id}", json.dumps(data), expiration_ttl=3600)
        
        await send_main_menu(bot, chat_id, data)

    except Exception as e:
        await bot.send_message(chat_id, f"An error occurred during the search: {e}")

@dispatcher.on_callback_query()
async def handle_callback(bot: TelegramBot, cb: CallbackQuery, env):
    """Handles all button clicks from inline keyboards."""
    data = cb.get("data", "")
    parts = data.split(":")
    action = parts[0]
    chat_id = cb["message"]["chat"]["id"]
    message_id = cb["message"]["message_id"]

    if action == "noop":
        await bot.answer_callback_query(cb['id'])
        return

    media_id = parts[-1]
    
    # Retrieve data from KV first for almost all actions
    data_str = await env.BOT_STATE.get(f"media:{media_id}")
    if not data_str:
        await bot.answer_callback_query(cb['id'], options={"text": "Sorry, this session has expired. Please search again.", "show_alert": True})
        return
    
    result_data = json.loads(data_str)

    if action == "view":
        media_type = parts[1]
        
        # Get available languages for the selected media type
        langs = result_data.get("images", {}).get(media_type, {}).keys()
        
        buttons = []
        for lang in sorted(langs):
            lang_name = lang.upper() if len(lang) == 2 else "No Language"
            count = len(result_data["images"][media_type][lang])
            buttons.append([{"text": f"{lang_name} ({count})", "callback_data": f"nav:{media_type}:{lang}:0:{media_id}"}])
        
        buttons.append([{"text": "« Back to Main Menu", "callback_data": f"back:main:{media_id}"}])
        
        await bot.edit_message_caption(
            caption=f"Select a language for *{result_data.get('title')}* {media_type.capitalize()}:",
            options={
                "chat_id": chat_id, "message_id": message_id,
                "parse_mode": "Markdown", "reply_markup": {"inline_keyboard": buttons}
            }
        )
        await bot.answer_callback_query(cb['id'])

    elif action == "nav":
        await handle_pagination(bot, cb, env, parts)

    elif action == "details":
        details = (
            f"🎬 *{result_data.get('title')}* ({result_data.get('year')})\n\n"
            f"*{result_data.get('tagline', '')}*\n\n"
            f"📖 *Plot:* {result_data.get('plot', 'N/A')}\n\n"
            f"⭐ *Rating:* {result_data.get('rating', 'N/A')} ({result_data.get('votes', 'N/A')} votes)\n"
            f"🕒 *Runtime:* {result_data.get('runtime', 'N/A')}\n"
            f"🎭 *Genres:* {result_data.get('genres', 'N/A')}\n\n"
            f"🔗 [View on TMDB]({result_data.get('url')})"
        )
        keyboard = {"inline_keyboard": [[{"text": "« Back to Main Menu", "callback_data": f"back:main:{media_id}"}]]}
        await bot.edit_message_caption(caption=details, options={"chat_id": chat_id, "message_id": message_id, "parse_mode": "Markdown", "reply_markup": keyboard})
        await bot.answer_callback_query(cb['id'])

    elif action == "back":
        destination = parts[1]
        if destination == "main":
            # Re-create the main menu by editing the current message
            plot = result_data.get("plot", "No summary available.")
            caption = f"🎬 *{result_data.get('title', 'N/A')}* ({result_data.get('year', 'N/A')})\n\n{plot[:800]}"
            keyboard = {
                "inline_keyboard": [
                    [
                        {"text": "🖼️ View Posters", "callback_data": f"view:posters:{media_id}"},
                        {"text": "🏞️ View Backdrops", "callback_data": f"view:backdrops:{media_id}"}
                    ],
                    [{"text": "ℹ️ Full Details", "callback_data": f"details:{media_id}"}]
                ]
            }
            # Use edit_message_caption as we are coming from a text-only or a photo message
            await bot.edit_message_caption(caption=caption, options={"chat_id": chat_id, "message_id": message_id, "parse_mode": "Markdown", "reply_markup": keyboard})
            await bot.answer_callback_query(cb['id'])

# -------------------------------------------------
# 4. Main Worker Handler
# -------------------------------------------------

class Default(WorkerEntrypoint):
    async def fetch(self, request: Request, env, ctx) -> Response:
        """Main Cloudflare Worker entry point."""
        bot = TelegramBot(token=env.BOT_TOKEN, dispatcher=dispatcher)
        url = request.url_obj
        if request.method == "POST":
            try:
                update = await request.json()
                # Pass the update and environment to the dispatcher
                await bot.handle_update(update, env)
            except Exception as e:
                print(f"Error processing update: {e}")


        # Handle manual webhook management via browser
        elif request.method == "GET":
            # The `/` route sets the webhook. You only need to visit this once.
            if url.pathname == "/":
                webhook_url = f"https://{url.hostname}/webhook" # A dedicated path for updates
                commands = [
                    {"command": "start", "description": "Start the bot"},
                    {"command": "help", "description": "Show help message"},
                ]
                await bot.set_my_commands(commands)
                result = await bot.set_webhook(webhook_url, options={"drop_pending_updates": True})

                if result.get("ok"):
                    return Response(f"✅ Webhook set successfully to {webhook_url}\n🤖 Bot commands updated.")
                else:
                    return Response(f"❌ Failed to set webhook: {result.get('description')}", status=500)

            # The `/delete` route removes the webhook
            elif url.pathname == "/delete":
                result = await bot.delete_webhook()
                if result.get("ok"):
                    message = "✅ Webhook deleted successfully!"
                    return Response(message, status=200)
                else:
                    description = result.get('description', 'Unknown error')
                    message = f"❌ Failed to delete webhook. Reason: {description}"
                    return Response(message, status=500)

            # The `/status` route checks the current webhook info
            elif url.pathname == "/status":
                result = await bot._post_json("getWebhookInfo", {})
                # Pretty-print the JSON for readability in the browser
                pretty_result = json.dumps(result, indent=2)
                return Response(pretty_result, headers={"Content-Type": "application/json"})

        return Response("Not Found. Visit `/` to set webhook, `/delete` to remove it, or `/status` to check it.", status=404)

# src/entry.py

from workers import Request, Response
import json
# Make sure telegram_bot.py is in the same `src` directory
from telegram_bot import TelegramBot, Dispatcher, Message, CallbackQuery

# -------------------------------------------------
# 1. Initialize the Dispatcher and Define Handlers
# -------------------------------------------------

# Create a single Dispatcher instance to register all your handlers
dispatcher = Dispatcher()

@dispatcher.on_message()
async def handle_message(bot: TelegramBot, message: Message, env):
    """Handler for all incoming text messages."""
    chat_id = message["chat"]["id"]
    user_id = message["from_user"]["id"]
    text = message.get("text", "")

    if text == "/start":
        # Example of using KV to store user data
        first_name = message["from_user"].get("first_name", "friend")
        await env.BOT_STATE.put(f"user:{user_id}:name", first_name)
        
        await bot.send_message(
            chat_id,
            f"Welcome, {first_name}! I'm a bot running on Cloudflare Workers. Try /help."
        )

    elif text == "/help":
        # Retrieve user's name from KV for a personalized message
        name = await env.BOT_STATE.get(f"user:{user_id}:name") or "friend"
        
        keyboard = {
            "inline_keyboard": [
                [{"text": "Show Alert", "callback_data": "alert:Hello!"}],
                [{"text": "Delete This Message", "callback_data": "delete_me"}]
            ]
        }
        await bot.send_message(
            chat_id,
            f"Hey {name}, I can echo messages and handle button clicks.",
            options={"reply_markup": keyboard}
        )
    
    else:
        # Simple echo for any other message
        await bot.send_message(chat_id, f"You said: {text}")


@dispatcher.on_callback_query()
async def handle_callback(bot: TelegramBot, cb: CallbackQuery, env):
    """Handler for all incoming callback queries from inline keyboards."""
    cb_id = cb["id"]
    data = cb.get("data", "")
    
    if data.startswith("alert:"):
        text_to_alert = data.split(":", 1)[1]
        await bot.answer_callback_query(cb_id, options={"text": text_to_alert, "show_alert": True})
    
    elif data == "delete_me":
        # Acknowledge the callback first
        await bot.answer_callback_query(cb_id, options={"text": "Message deleted!"})
        # Then delete the original message
        await bot.delete_message(
            chat_id=cb["message"]["chat"]["id"],
            message_id=cb["message"]["message_id"]
        )
    
    else:
        # Acknowledge any other callback quietly
        await bot.answer_callback_query(cb_id)


# -------------------------------------------------
# 2. Define the Worker's Fetch Handler
# -------------------------------------------------

async def fetch(request: Request, env) -> Response:
    """
    The main Cloudflare Worker entry point. It handles webhook management
    (setup, status, deletion) and processes incoming updates from Telegram.
    """
    bot = TelegramBot(token=env.BOT_TOKEN, dispatcher=dispatcher)
    url = request.url_obj

    # Handle incoming updates from Telegram
    if request.method == "POST":
        try:
            update = await request.json()
            # Pass the update and environment to the dispatcher for processing
            await bot.handle_update(update, env)
            return Response("ok", status=200)
        except Exception as e:
            print(f"Error processing update: {e}")
            return Response("Error processing update", status=500)
    
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
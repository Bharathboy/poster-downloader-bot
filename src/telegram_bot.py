"""
telegram_bot.py (v2 - Advanced)

Advanced, reusable TelegramBot class for Cloudflare Python Workers (async).
- Includes a Dispatcher for clean, decorator-based handling of updates.
- Refactored file uploads and expanded API method coverage.
- Uses TypedDict for lightweight data modeling and improved type safety.
- Continues to normalize inline keyboards and provide uniform error handling.
"""

from typing import Optional, Dict, Any, List, Union, Tuple, Callable, Awaitable
from typing import TypedDict
import json
import secrets

# On Cloudflare Python Workers runtime, use `from workers import fetch`.
try:
    from workers import fetch
except ImportError:
    raise RuntimeError("This module expects Cloudflare Workers runtime 'fetch' (from `workers`).")

# -------------------------
# Type Definitions & Models
# -------------------------
JSON = Dict[str, Any]

class User(TypedDict, total=False):
    id: int
    is_bot: bool
    first_name: str
    last_name: str
    username: str

class Chat(TypedDict, total=False):
    id: int
    type: str
    title: str
    username: str

class Message(TypedDict, total=False):
    message_id: int
    from_user: User
    chat: Chat
    date: int
    text: str
    caption: str

class CallbackQuery(TypedDict, total=False):
    id: str
    from_user: User
    message: Message
    inline_message_id: str
    data: str

class Update(TypedDict, total=False):
    update_id: int
    message: Message
    callback_query: CallbackQuery


# -------------------------
# Dispatcher for Handlers
# -------------------------
BotHandler = Callable[['TelegramBot', Any], Awaitable[None]]

class Dispatcher:
    """A simple dispatcher to route updates to decorated handler functions."""
    def __init__(self):
        self.message_handlers: List[BotHandler] = []
        self.callback_query_handlers: List[BotHandler] = []

    def on_message(self) -> Callable[[BotHandler], BotHandler]:
        """Decorator to register a message handler."""
        def decorator(func: BotHandler) -> BotHandler:
            self.message_handlers.append(func)
            return func
        return decorator

    def on_callback_query(self) -> Callable[[BotHandler], BotHandler]:
        """Decorator to register a callback_query handler."""
        def decorator(func: BotHandler) -> BotHandler:
            self.callback_query_handlers.append(func)
            return func
        return decorator

    async def route_update(self, bot: 'TelegramBot', update: Update):
        """Routes an incoming update to the appropriate registered handlers."""
        if 'message' in update and update['message']:
            for handler in self.message_handlers:
                await handler(bot, update['message'])
        elif 'callback_query' in update and update['callback_query']:
            for handler in self.callback_query_handlers:
                await handler(bot, update['callback_query'])


# -------------------------
# Main TelegramBot Class
# -------------------------
class TelegramBot:
    """Advanced TelegramBot helper class for Cloudflare Workers."""

    def __init__(self, token: str, dispatcher: Optional[Dispatcher] = None):
        self.token = token
        self.api_url = f"https://api.telegram.org/bot{token}"
        self.dispatcher = dispatcher

    async def handle_update(self, update_data: JSON):
        """Passes an update to the dispatcher if one is configured."""
        if self.dispatcher:
            await self.dispatcher.route_update(self, update_data)
        else:
            print("Warning: Update received but no dispatcher is configured.")

    # -------------------------
    # Low-level helpers
    # -------------------------
    async def _api_call(self, method: str, content_type: str, body: Union[str, bytes]) -> JSON:
        """Generic method to make API calls."""
        url = f"{self.api_url}/{method}"
        try:
            resp = await fetch(url, method="POST", headers={"Content-Type": content_type}, body=body)
            return await resp.json()
        except Exception as e:
            return {"ok": False, "description": str(e)}

    async def _post_json(self, method: str, payload: JSON) -> JSON:
        """Send JSON POST to Telegram and return parsed JSON or error-dict."""
        return await self._api_call(method, "application/json", json.dumps(payload))

    def _fix_reply_markup(self, reply_markup: Optional[JSON]) -> Optional[JSON]:
        if not reply_markup or "inline_keyboard" not in reply_markup:
            return reply_markup
        rm = dict(reply_markup)
        fixed_kb = []
        for row in rm["inline_keyboard"]:
            fixed_row = []
            for btn in row:
                btn_copy = dict(btn)
                cb = btn_copy.pop("callbackData", None) or btn_copy.pop("callback", None)
                if cb is not None:
                    btn_copy["callback_data"] = cb
                fixed_row.append(btn_copy)
            fixed_kb.append(fixed_row)
        rm["inline_keyboard"] = fixed_kb
        return rm

    def _build_multipart(self, fields: Dict[str, str], file_field_name: str, filename: str, file_bytes: bytes, content_type: str) -> Tuple[bytes, str]:
        boundary = "----BotBoundary" + secrets.token_hex(16)
        parts: List[bytes] = []
        for name, value in fields.items():
            parts.extend([
                f"--{boundary}\r\n".encode('utf-8'),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode('utf-8'),
                str(value).encode('utf-8'),
                b"\r\n"
            ])
        parts.extend([
            f"--{boundary}\r\n".encode('utf-8'),
            f'Content-Disposition: form-data; name="{file_field_name}"; filename="{filename}"\r\n'.encode('utf-8'),
            f"Content-Type: {content_type}\r\n\r\n".encode('utf-8'),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode('utf-8')
        ])
        body = b"".join(parts)
        content_type_header = f"multipart/form-data; boundary={boundary}"
        return body, content_type_header
    
    async def _send_file(self, method: str, file_field: str, chat_id: Union[int, str], file_data: Union[str, bytes], default_filename: str, default_mimetype: str, options: Optional[JSON] = None) -> JSON:
        """Refactored helper for sending files via multipart or file_id/URL."""
        if isinstance(file_data, (bytes, bytearray)):
            fields = {"chat_id": str(chat_id)}
            opts = options or {}
            for k, v in opts.items():
                if k in ("filename", "content_type"): continue
                fields[k] = json.dumps(v) if isinstance(v, dict) else str(v)
            
            filename = opts.get("filename", default_filename)
            content_type = opts.get("content_type", default_mimetype)
            
            body, ctype = self._build_multipart(fields, file_field, filename, bytes(file_data), content_type)
            return await self._api_call(method, ctype, body)
        else:
            payload: JSON = {"chat_id": chat_id, file_field: file_data}
            if options:
                opts = dict(options)
                if "reply_markup" in opts:
                    payload["reply_markup"] = self._fix_reply_markup(opts.pop("reply_markup"))
                payload.update(opts)
            return await self._post_json(method, payload)

    # -------------------------
    # Webhook & Bot Commands
    # -------------------------
    async def set_webhook(self, url: str, options: Optional[JSON] = None) -> JSON:
        return await self._post_json("setWebhook", {"url": url, **(options or {})})

    async def delete_webhook(self, options: Optional[JSON] = None) -> JSON:
        return await self._post_json("deleteWebhook", options or {})

    async def set_my_commands(self, commands: List[Dict[str, str]], options: Optional[JSON] = None) -> JSON:
        """Set the bot's command list. E.g., [{"command":"start", "description":"Start bot"}]"""
        return await self._post_json("setMyCommands", {"commands": commands, **(options or {})})

    async def delete_my_commands(self, options: Optional[JSON] = None) -> JSON:
        return await self._post_json("deleteMyCommands", options or {})

    # -------------------------
    # Messaging
    # -------------------------
    async def send_message(self, chat_id: Union[int, str], text: str, options: Optional[JSON] = None) -> JSON:
        payload: JSON = {"chat_id": chat_id, "text": text}
        if options:
            opts = dict(options)
            if "reply_markup" in opts:
                payload["reply_markup"] = self._fix_reply_markup(opts.pop("reply_markup"))
            payload.update(opts)
        return await self._post_json("sendMessage", payload)

    async def edit_message_text(self, text: str, options: Optional[JSON] = None) -> JSON:
        payload: JSON = {"text": text}
        if options:
            opts = dict(options)
            if "reply_markup" in opts:
                payload["reply_markup"] = self._fix_reply_markup(opts.pop("reply_markup"))
            payload.update(opts)
        return await self._post_json("editMessageText", payload)

    async def delete_message(self, chat_id: Union[int, str], message_id: int) -> JSON:
        return await self._post_json("deleteMessage", {"chat_id": chat_id, "message_id": message_id})

    async def answer_callback_query(self, callback_query_id: str, options: Optional[JSON] = None) -> JSON:
        return await self._post_json("answerCallbackQuery", {"callback_query_id": callback_query_id, **(options or {})})

    async def send_chat_action(self, chat_id: Union[int, str], action: str) -> JSON:
        """Send a chat action like 'typing', 'upload_photo', etc."""
        return await self._post_json("sendChatAction", {"chat_id": chat_id, "action": action})

    # -------------------------
    # File & Media Sending
    # -------------------------
    async def get_file(self, file_id: str) -> JSON:
        return await self._post_json("getFile", {"file_id": file_id})

    async def download_file(self, file_path: str) -> Optional[bytes]:
        """Downloads a file using the file_path from a getFile response."""
        url = f"https://api.telegram.org/file/bot{self.token}/{file_path}"
        try:
            resp = await fetch(url)
            if resp.status == 200:
                return await resp.arrayBuffer()
            return None
        except Exception:
            return None

    async def send_photo(self, chat_id: Union[int, str], photo: Union[str, bytes], options: Optional[JSON] = None) -> JSON:
        return await self._send_file("sendPhoto", "photo", chat_id, photo, "photo.jpg", "image/jpeg", options)

    async def send_video(self, chat_id: Union[int, str], video: Union[str, bytes], options: Optional[JSON] = None) -> JSON:
        return await self._send_file("sendVideo", "video", chat_id, video, "video.mp4", "video/mp4", options)

    async def send_document(self, chat_id: Union[int, str], document: Union[str, bytes], options: Optional[JSON] = None) -> JSON:
        return await self._send_file("sendDocument", "document", chat_id, document, "file.bin", "application/octet-stream", options)
    
    async def send_audio(self, chat_id: Union[int, str], audio: Union[str, bytes], options: Optional[JSON] = None) -> JSON:
        return await self._send_file("sendAudio", "audio", chat_id, audio, "audio.mp3", "audio/mpeg", options)
        
    async def send_voice(self, chat_id: Union[int, str], voice: Union[str, bytes], options: Optional[JSON] = None) -> JSON:
        return await self._send_file("sendVoice", "voice", chat_id, voice, "voice.ogg", "audio/ogg", options)
    
    async def send_poll(self, chat_id: Union[int, str], question: str, poll_options: List[str], options: Optional[JSON] = None) -> JSON:
        """Sends a poll. `poll_options` is a list of strings."""
        payload: JSON = {"chat_id": chat_id, "question": question, "options": poll_options}
        if options:
            payload.update(options)
        return await self._post_json("sendPoll", payload)

    # -------------------------
    # Chat Management
    # -------------------------
    async def ban_chat_member(self, chat_id: Union[int, str], user_id: int, options: Optional[JSON] = None) -> JSON:
        """Ban a user from a group, supergroup or channel."""
        return await self._post_json("banChatMember", {"chat_id": chat_id, "user_id": user_id, **(options or {})})
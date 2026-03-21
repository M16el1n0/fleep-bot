import logging
import sqlite3
import os
import asyncio
import json
import hmac
import hashlib
from aiohttp import web
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, LabeledPrice
from telegram.ext import (
    Application, CommandHandler, MessageHandler, PreCheckoutQueryHandler,
    CallbackQueryHandler, ContextTypes, ConversationHandler, filters
)

# ─── CONFIG ───────────────────────────────────────────────────────────────────
BOT_TOKEN      = "8700173300:AAFguL_dEKOSUvOep_7iK1MIaiTaaFex2bg"
ADMIN_USERNAME = "m16el1n0"
ADMIN_SECRET   = "fleep_admin_2026"  # секрет для /admin/stats
WEB_APP_URL    = "https://t.me/fleep_gift_bot/GAME"
DB_PATH        = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.db")

# ─── ПРОМОКОДЫ ────────────────────────────────────────────────────────────────
PROMO_CODES = {
    "VESNA26": 0.20,   # +20%
}

MIN_STARS = 1
MAX_STARS = 10000

# Railway/Render выставляют PORT сами, локально не используется
PORT = int(os.environ.get("PORT", 0))

# ─── CONVERSATION STATES ──────────────────────────────────────────────────────
(
    WAIT_BROADCAST_TEXT,
    WAIT_BROADCAST_BTN,
    WAIT_TOPUP_AMOUNT,
    WAIT_TOPUP_PROMO,
    WAIT_ADDBAL_USER,
    WAIT_ADDBAL_AMOUNT,
    WAIT_ADDBAL_TYPE,
) = range(7)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ─── DATABASE ─────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id    INTEGER PRIMARY KEY,
            username   TEXT,
            full_name  TEXT,
            gold_coins INTEGER NOT NULL DEFAULT 0,
            silver_coins INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            username   TEXT,
            full_name  TEXT,
            type       TEXT NOT NULL,
            method     TEXT,
            amount     INTEGER NOT NULL,
            currency   TEXT DEFAULT 'gold',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    for col in ["gold_coins", "silver_coins"]:
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
    conn.commit()
    conn.close()


def record_transaction(user_id: int, username: str, full_name: str,
                       ttype: str, method: str, amount: int, currency: str = "gold"):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO transactions (user_id, username, full_name, type, method, amount, currency) VALUES (?,?,?,?,?,?,?)",
        (user_id, username, full_name, ttype, method, amount, currency)
    )
    conn.commit()
    conn.close()


def get_transaction_stats():
    """Returns dict with total deposits and withdrawals"""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("""
        SELECT type, method, SUM(amount), COUNT(*)
        FROM transactions
        GROUP BY type, method
        ORDER BY type, method
    """).fetchall()
    recent = conn.execute("""
        SELECT created_at, username, full_name, type, method, amount, currency
        FROM transactions
        ORDER BY id DESC LIMIT 20
    """).fetchall()
    conn.close()
    return {"summary": rows, "recent": recent}


def save_user(user):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO users (user_id, username, full_name, gold_coins)
           VALUES (?, ?, ?, 0)
           ON CONFLICT(user_id) DO UPDATE SET
               username=excluded.username,
               full_name=excluded.full_name""",
        (user.id, user.username, user.full_name)
    )
    conn.commit()
    conn.close()


def get_gold(user_id: int) -> int:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT gold_coins FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row[0] if row else 0


def add_gold(user_id: int, amount: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR IGNORE INTO users (user_id, gold_coins) VALUES (?, 0)",
        (user_id,)
    )
    conn.execute(
        "UPDATE users SET gold_coins = gold_coins + ? WHERE user_id = ?",
        (amount, user_id)
    )
    conn.commit()
    conn.close()


def add_silver(user_id: int, amount: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR IGNORE INTO users (user_id, silver_coins) VALUES (?, 0)",
        (user_id,)
    )
    conn.execute(
        "UPDATE users SET silver_coins = silver_coins + ? WHERE user_id = ?",
        (amount, user_id)
    )
    conn.commit()
    conn.close()


def find_user_by_username(query: str):
    """Ищет по username (с @ или без) или по user_id (число). Возвращает (user_id, username, full_name) или None"""
    query = query.strip().lstrip("@")
    conn = sqlite3.connect(DB_PATH)
    # Попытка найти по числовому user_id
    if query.isdigit():
        row = conn.execute(
            "SELECT user_id, username, full_name FROM users WHERE user_id=?",
            (int(query),)
        ).fetchone()
        if row:
            conn.close()
            return row
    # Поиск по username (без учёта регистра)
    row = conn.execute(
        "SELECT user_id, username, full_name FROM users WHERE LOWER(username)=LOWER(?)",
        (query,)
    ).fetchone()
    conn.close()
    return row


def get_balance(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT gold_coins, silver_coins FROM users WHERE user_id=?", (user_id,)
    ).fetchone()
    conn.close()
    return (row[0], row[1]) if row else (0, 0)


def get_all_users():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id FROM users").fetchall()
    conn.close()
    return [r[0] for r in rows]


def count_users():
    conn = sqlite3.connect(DB_PATH)
    n = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    conn.close()
    return n


# ─── HELPERS ──────────────────────────────────────────────────────────────────
def make_even(n: int) -> int:
    return n if n % 2 == 0 else n + 1


def calc_coins(stars: int, promo: str | None) -> int:
    if promo and promo.upper() in PROMO_CODES:
        coins = int(stars * (1 + PROMO_CODES[promo.upper()]))
        return make_even(coins)
    return stars


async def do_send_invoice(bot, chat_id: int, user_id: int, stars: int, promo: str | None):
    promo_valid = promo and promo in PROMO_CODES
    final_coins = calc_coins(stars, promo)
    bonus_pct   = int(PROMO_CODES[promo] * 100) if promo_valid else 0

    title = f"⭐ {stars} -> 🟡 {final_coins} коинов"
    desc  = f"🟡 {final_coins} золотых коинов для FLEEP GIFT"
    if promo_valid:
        title += f" (+{bonus_pct}%)"
        desc  += f" (+{bonus_pct}% по промокоду {promo})"

    payload = f"stars_{stars}_{final_coins}_{user_id}"
    await bot.send_invoice(
        chat_id=chat_id,
        title=title,
        description=desc,
        payload=payload,
        currency="XTR",
        prices=[LabeledPrice("Звёзды Telegram", stars)],
    )


# ─── ВЕРИФИКАЦИЯ TELEGRAM initData ───────────────────────────────────────────
def verify_init_data(init_data: str) -> bool:
    try:
        pairs, hash_val = {}, None
        for part in init_data.split("&"):
            k, _, v = part.partition("=")
            if k == "hash":
                hash_val = v
            else:
                pairs[k] = v
        if not hash_val:
            return False
        check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
        secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        return hmac.compare_digest(
            hmac.new(secret, check.encode(), hashlib.sha256).hexdigest(),
            hash_val
        )
    except Exception:
        return False


CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


# ─── HTTP: GET /balance ───────────────────────────────────────────────────────
async def http_balance(request: web.Request) -> web.Response:
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)

    user_id   = request.rel_url.query.get("user_id")
    init_data = request.rel_url.query.get("init_data", "")

    if not user_id:
        return web.json_response({"error": "no user_id"}, status=400, headers=CORS)

    # Allow polling without init_data (post-payment balance checks)
    # Only enforce strict auth when init_data is provided and non-empty
    if init_data and not verify_init_data(init_data):
        return web.json_response({"error": "unauthorized"}, status=403, headers=CORS)

    gold, silver = get_balance(int(user_id))
    return web.json_response({"gold_coins": gold, "silver_coins": silver}, headers=CORS)


async def http_health(request: web.Request) -> web.Response:
    return web.Response(text="OK")


async def http_create_invoice(request: web.Request) -> web.Response:
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)
    try:
        data     = await request.json()
        user_id  = int(data.get("user_id", 0))
        stars    = int(data.get("stars", 0))
        promo    = data.get("promo")
        if not user_id or not stars:
            return web.json_response({"error": "bad params"}, status=400, headers=CORS)

        final_coins = calc_coins(stars, promo)
        payload     = f"stars_{stars}_{final_coins}_{user_id}"
        logger.info(f"Creating invoice: user={user_id} stars={stars} coins={final_coins}")
        # Прямой вызов Telegram API — работает со всеми версиями PTB
        import aiohttp as _aiohttp
        async with _aiohttp.ClientSession() as _sess:
            async with _sess.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/createInvoiceLink",
                json={
                    "title": f"⭐ {stars} → 🟡 {final_coins} коинов",
                    "description": "Пополнение баланса FLEEP GIFT",
                    "payload": payload,
                    "provider_token": "",
                    "currency": "XTR",
                    "prices": [{"label": "Звёзды Telegram", "amount": stars}]
                }
            ) as _resp:
                _data = await _resp.json()
        if not _data.get("ok"):
            raise Exception(_data.get("description", "Telegram API error"))
        result = _data["result"]
        logger.info(f"Invoice created: {result[:60] if result else 'None'}")
        return web.json_response({"invoice_url": result}, headers=CORS)
    except Exception as e:
        logger.error(f"create_invoice error: {type(e).__name__}: {e}")
        return web.json_response({"error": str(e)}, status=500, headers=CORS)


async def http_admin_stats(request: web.Request) -> web.Response:
    """Статистика пополнений и выводов для /admin"""
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)
    # Simple auth via secret header or param
    secret = request.rel_url.query.get("secret", "")
    if secret != ADMIN_SECRET:
        return web.json_response({"error": "unauthorized"}, status=403, headers=CORS)
    stats = get_transaction_stats()
    return web.json_response(stats, headers=CORS)


async def http_admin_panel(request: web.Request) -> web.Response:
    """HTML админ-панель со статистикой пополнений и выводов"""
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)
    secret = request.rel_url.query.get("secret", "")
    if secret != ADMIN_SECRET:
        return web.Response(text="<h1>403 Unauthorized</h1>", content_type="text/html", status=403)
    
    stats  = get_transaction_stats()
    total_users = count_users()
    
    dep_stars, dep_usdt, dep_total = 0, 0, 0
    wd_total = 0
    for row in stats["summary"]:
        ttype, method, amount, count = row
        if ttype == "deposit":
            dep_total += amount
            if method == "stars": dep_stars += amount
            elif method == "usdt": dep_usdt += amount
        elif ttype == "withdrawal":
            wd_total += amount

    rows_html = ""
    for row in stats["recent"]:
        ts, uname, fname, ttype, method, amount, currency = row
        date = ts[:16].replace("T"," ") if ts else "?"
        who  = f"@{uname}" if uname else (fname or "?")
        icon = "🟢" if ttype == "deposit" else "🔴"
        sign = "+" if ttype == "deposit" else "-"
        rows_html += f"<tr><td>{date}</td><td>{who}</td><td>{icon} {ttype}</td><td>{method}</td><td style='color:{'#4ade80' if ttype=='deposit' else '#f87171'}'>{sign}{amount} {currency}</td></tr>\n"

    html_page = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FLEEP GIFT — Админ</title>
<style>
  body{{margin:0;font-family:system-ui,sans-serif;background:#0a0a12;color:#e2e8f0;padding:20px}}
  h1{{color:#a78bfa;margin-bottom:20px;font-size:1.4rem}}
  .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px}}
  .card{{background:#13131f;border:1.5px solid rgba(123,92,255,0.2);border-radius:14px;padding:18px}}
  .card-val{{font-size:1.8rem;font-weight:900;color:#a78bfa}}
  .card-lbl{{font-size:0.72rem;color:#555;margin-top:4px;text-transform:uppercase;letter-spacing:1px}}
  table{{width:100%;border-collapse:collapse;background:#13131f;border-radius:14px;overflow:hidden}}
  th{{background:rgba(123,92,255,0.15);padding:10px 12px;text-align:left;font-size:0.75rem;color:#a78bfa;text-transform:uppercase;letter-spacing:1px}}
  td{{padding:10px 12px;font-size:0.8rem;border-bottom:1px solid rgba(255,255,255,0.04)}}
  tr:last-child td{{border-bottom:none}}
  tr:hover td{{background:rgba(255,255,255,0.02)}}
  h2{{color:#7b5cff;font-size:1rem;margin:24px 0 12px;text-transform:uppercase;letter-spacing:2px}}
</style>
</head>
<body>
<h1>🛠 FLEEP GIFT — Админ-панель</h1>
<div class="cards">
  <div class="card"><div class="card-val">{total_users}</div><div class="card-lbl">Пользователей</div></div>
  <div class="card"><div class="card-val" style="color:#fcd34d">{dep_total} 🟡</div><div class="card-lbl">Итого пополнено</div></div>
  <div class="card"><div class="card-val" style="color:#fb923c">{dep_stars} 🟡</div><div class="card-lbl">Через Stars</div></div>
  <div class="card"><div class="card-val" style="color:#34d399">{dep_usdt} 🟡</div><div class="card-lbl">Через USDT</div></div>
  <div class="card"><div class="card-val" style="color:#f87171">{wd_total}</div><div class="card-lbl">Выводов (подарков)</div></div>
</div>
<h2>Последние 20 транзакций</h2>
<table>
<thead><tr><th>Дата</th><th>Пользователь</th><th>Тип</th><th>Метод</th><th>Сумма</th></tr></thead>
<tbody>{rows_html}</tbody>
</table>
</body>
</html>"""
    return web.Response(text=html_page, content_type="text/html")

async def http_withdraw_gift(request: web.Request) -> web.Response:
    """Запрос на вывод подарка из инвентаря"""
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)
    try:
        data       = await request.json()
        user_id    = int(data.get("user_id", 0))
        username   = data.get("username", "")
        gift_name  = data.get("gift_name", "Подарок")
        gift_emoji = data.get("gift_emoji", "🎁")
        gift_value = int(data.get("gift_value", 0))
        gift_type  = data.get("gift_type", "gift")

        if not user_id:
            return web.json_response({"error": "no user_id"}, status=400, headers=CORS)

        # Записываем транзакцию
        record_transaction(user_id, username, "", "withdrawal", "gift", gift_value, "gift")

        # Уведомляем администратора
        bot = request.app.get("bot")
        if bot:
            try:
                from telegram import Bot
                who = f"@{username}" if username else str(user_id)
                msg = (
                    f"📤 *Запрос на вывод подарка*\n\n"
                    f"👤 Пользователь: {who} (id: `{user_id}`)\n"
                    f"🎁 Подарок: {gift_emoji} {gift_name}\n"
                    f"💰 Стоимость: *{gift_value} F*\n\n"
                    f"Подарок нужно отправить в Telegram!"
                )
                # Найдём username администратора через переменную
                conn = __import__("sqlite3").connect(DB_PATH)
                admin_row = conn.execute(
                    "SELECT user_id FROM users WHERE username=?", (ADMIN_USERNAME,)
                ).fetchone()
                conn.close()
                if admin_row:
                    await bot.send_message(admin_row[0], msg, parse_mode="Markdown")
            except Exception as e:
                logger.error(f"notify admin error: {e}")

        logger.info(f"Withdrawal request: user={user_id} gift={gift_name} value={gift_value}")
        return web.json_response({"ok": True}, headers=CORS)
    except Exception as e:
        logger.error(f"withdraw_gift error: {e}")
        return web.json_response({"error": str(e)}, status=500, headers=CORS)





# ─── CRYPTOBOT WEBHOOK ────────────────────────────────────────────────────────
CRYPTOBOT_TOKEN = "542304:AAyfVT4SyISn08Y0GY8WcJPpDGP8TqZXUW3"
CRYPTOBOT_API   = "https://pay.crypt.bot/api"
COINS_PER_USDT  = 66.67  # 100 coins = 1.5 USDT


async def http_create_usdt_invoice(request: web.Request) -> web.Response:
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)
    try:
        import aiohttp as aiohttp_lib
        data    = await request.json()
        user_id = int(data.get("user_id", 0))
        coins   = int(data.get("coins", 0))
        if not user_id or not coins:
            return web.json_response({"error": "bad params"}, status=400, headers=CORS)

        usdt_amount = round(coins / COINS_PER_USDT, 2)
        payload = {"asset": "USDT", "amount": usdt_amount,
                   "description": f"FLEEP GIFT: {coins} коинов",
                   "payload": f"usdt_{coins}_{user_id}",
                   "allow_anonymous": True}
        async with aiohttp_lib.ClientSession() as session:
            async with session.post(
                f"{CRYPTOBOT_API}/createInvoice",
                json=payload,
                headers={"Crypto-Pay-API-Token": CRYPTOBOT_TOKEN}
            ) as resp:
                result = await resp.json()
        if not result.get("ok"):
            raise Exception(result.get("error", {}).get("name", "Unknown error"))
        invoice = result["result"]
        # pay_url = https://t.me/CryptoBot?start=IV... (открывается через openTelegramLink)
        # bot_invoice_url = https://t.me/$CryptoBot?start=IV... (тоже подходит)
        pay_link = invoice.get("bot_invoice_url") or invoice.get("pay_url", "")
        return web.json_response({
            "wallet":      pay_link,
            "invoice_id":  invoice.get("invoice_id"),
            "amount":      usdt_amount,
            "coins":       coins
        }, headers=CORS)
    except Exception as e:
        logger.error(f"create_usdt_invoice error: {e}")
        return web.json_response({"error": str(e)}, status=500, headers=CORS)


async def http_cryptobot_webhook(request: web.Request) -> web.Response:
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)
    try:
        body = await request.json()
        update_type = body.get("update_type")
        if update_type != "invoice_paid":
            return web.json_response({"ok": True}, headers=CORS)
        invoice = body.get("payload", {})
        raw_payload = invoice.get("payload", "")
        if not raw_payload.startswith("usdt_"):
            return web.json_response({"ok": True}, headers=CORS)
        parts    = raw_payload.split("_")
        coins    = int(parts[1])
        user_id  = int(parts[2])
        uname    = ""
        add_gold(user_id, coins)
        record_transaction(user_id, uname, "", "deposit", "usdt", coins, "gold")
        logger.info(f"CryptoBot payment: user={user_id} +{coins} gold")
        return web.json_response({"ok": True}, headers=CORS)
    except Exception as e:
        logger.error(f"cryptobot_webhook error: {e}")
        return web.json_response({"error": str(e)}, status=500, headers=CORS)
async def start_http(application):
    app_http = web.Application()
    app_http["bot"] = application.bot
    app_http.router.add_get("/",             http_health)
    app_http.router.add_get("/balance",      http_balance)
    app_http.router.add_options("/balance",  http_balance)
    app_http.router.add_post("/create_invoice",         http_create_invoice)
    app_http.router.add_options("/create_invoice",      http_create_invoice)
    app_http.router.add_post("/create_usdt_invoice",    http_create_usdt_invoice)
    app_http.router.add_options("/create_usdt_invoice", http_create_usdt_invoice)
    app_http.router.add_post("/cryptobot_webhook",      http_cryptobot_webhook)
    app_http.router.add_options("/cryptobot_webhook",   http_cryptobot_webhook)
    app_http.router.add_get("/admin/stats",  http_admin_stats)
    app_http.router.add_get("/admin/panel",  http_admin_panel)
    app_http.router.add_post("/withdraw_gift",        http_withdraw_gift)
    app_http.router.add_options("/withdraw_gift",     http_withdraw_gift)
    runner = web.AppRunner(app_http)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    logger.info(f"HTTP server on port {PORT}")


# ─── /start ───────────────────────────────────────────────────────────────────
async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    save_user(user)
    keyboard = [[InlineKeyboardButton("🎮 Играть!", url=WEB_APP_URL)]]
    await update.message.reply_text(
        "👋 Приветствуем в *FLEEP GIFT*!\n\n"
        "Нажми кнопку ниже, чтобы открыть игру 🎉\n\n"
        "💰 Пополнить коины: /topup\n"
        "📊 Баланс: /balance",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


# ─── /balance ─────────────────────────────────────────────────────────────────
async def balance_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    save_user(user)
    gold = get_gold(user.id)
    await update.message.reply_text(
        f"💰 *Твой баланс*\n\n🟡 Золотые коины: *{gold}*",
        parse_mode="Markdown"
    )


# ─── /topup — точка входа ─────────────────────────────────────────────────────
async def topup_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /topup              -> меню
    /topup 75           -> сразу инвойс
    /topup 75 VESNA26   -> инвойс с промокодом
    """
    user = update.effective_user
    save_user(user)
    args = ctx.args or []

    if args:
        try:
            stars = int(args[0])
        except ValueError:
            await update.message.reply_text(
                "❌ Укажи число. Например: `/topup 75`", parse_mode="Markdown"
            )
            return ConversationHandler.END

        if not (MIN_STARS <= stars <= MAX_STARS):
            await update.message.reply_text(
                f"❌ От {MIN_STARS} до {MAX_STARS:,} звёзд.\nНапример: `/topup 75`",
                parse_mode="Markdown"
            )
            return ConversationHandler.END

        promo = args[1].upper() if len(args) > 1 else None
        if promo and promo not in PROMO_CODES:
            await update.message.reply_text(f"⚠️ Промокод «{promo}» не найден. Продолжаем без него.")
            promo = None

        await do_send_invoice(ctx.bot, update.effective_chat.id, user.id, stars, promo)
        return ConversationHandler.END

    # Меню с кнопками
    keyboard = [
        [
            InlineKeyboardButton("🌱 50 ⭐",   callback_data="tq_50"),
            InlineKeyboardButton("⚡ 100 ⭐",  callback_data="tq_100"),
            InlineKeyboardButton("🔥 250 ⭐",  callback_data="tq_250"),
        ],
        [
            InlineKeyboardButton("💎 500 ⭐",  callback_data="tq_500"),
            InlineKeyboardButton("👑 1000 ⭐", callback_data="tq_1000"),
        ],
        [InlineKeyboardButton("✏️ Своя сумма", callback_data="tq_custom")],
    ]
    await update.message.reply_text(
        "⭐ *Пополнение золотых коинов*\n\n"
        "1 звезда Telegram = 1 🟡 золотой коин\n"
        f"Минимум {MIN_STARS} ⭐, максимум {MAX_STARS:,} ⭐\n\n"
        "Выбери пакет или нажми *«Своя сумма»*\n"
        "Промокод: `/topup 75 VESNA26`",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return WAIT_TOPUP_AMOUNT


# ─── Кнопки быстрого выбора ───────────────────────────────────────────────────
async def topup_quick(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "tq_custom":
        await query.message.reply_text(
            "✏️ Введи количество звёзд (от 1 до 10 000):"
        )
        return WAIT_TOPUP_AMOUNT

    stars = int(query.data.split("_")[1])
    ctx.user_data["topup_stars"] = stars

    coins = calc_coins(stars, None)
    keyboard = [[
        InlineKeyboardButton("✅ Без промокода", callback_data="tq_nopromo"),
        InlineKeyboardButton("🎟 Есть промокод", callback_data="tq_haspromo"),
    ]]
    await query.message.reply_text(
        f"⭐ *{stars} звёзд* -> 🟡 *{coins} коинов*\n\nЕсть промокод?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return WAIT_TOPUP_PROMO


# ─── Ввод своей суммы ─────────────────────────────────────────────────────────
async def topup_receive_amount(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    try:
        stars = int(update.message.text.strip())
    except ValueError:
        await update.message.reply_text("❌ Введи число. Например: 75")
        return WAIT_TOPUP_AMOUNT

    if not (MIN_STARS <= stars <= MAX_STARS):
        await update.message.reply_text(f"❌ От {MIN_STARS} до {MAX_STARS:,}. Попробуй ещё раз:")
        return WAIT_TOPUP_AMOUNT

    ctx.user_data["topup_stars"] = stars
    coins = calc_coins(stars, None)

    keyboard = [[
        InlineKeyboardButton("✅ Без промокода", callback_data="tq_nopromo"),
        InlineKeyboardButton("🎟 Есть промокод", callback_data="tq_haspromo"),
    ]]
    await update.message.reply_text(
        f"⭐ *{stars} звёзд* -> 🟡 *{coins} коинов*\n\nЕсть промокод?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return WAIT_TOPUP_PROMO


# ─── Промокод: выбор ──────────────────────────────────────────────────────────
async def topup_promo_choice(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user  = query.from_user
    stars = ctx.user_data.get("topup_stars", 0)

    if query.data == "tq_nopromo":
        await do_send_invoice(ctx.bot, query.message.chat_id, user.id, stars, None)
        return ConversationHandler.END

    await query.message.reply_text("🎟 Введи промокод:")
    return WAIT_TOPUP_PROMO


# ─── Промокод: текст ──────────────────────────────────────────────────────────
async def topup_receive_promo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user  = update.effective_user
    stars = ctx.user_data.get("topup_stars", 0)
    promo = update.message.text.strip().upper()

    if promo not in PROMO_CODES:
        await update.message.reply_text(
            f"❌ Промокод «{promo}» не найден. Отправляю без промокода."
        )
        promo = None
    else:
        bonus = int(PROMO_CODES[promo] * 100)
        await update.message.reply_text(f"✅ Промокод применён: +{bonus}%!")

    await do_send_invoice(ctx.bot, update.effective_chat.id, user.id, stars, promo)
    return ConversationHandler.END


async def topup_cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Отменено.")
    return ConversationHandler.END


# ─── PRE-CHECKOUT ─────────────────────────────────────────────────────────────
async def pre_checkout(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.pre_checkout_query
    logger.info(f"PreCheckout: user={query.from_user.id} payload={query.invoice_payload}")
    parts = query.invoice_payload.split("_")
    if len(parts) == 4 and parts[0] == "stars":
        await query.answer(ok=True)
        logger.info(f"PreCheckout OK: {query.invoice_payload}")
    else:
        await query.answer(ok=False, error_message="Неверный запрос. Попробуй ещё раз.")
        logger.warning(f"PreCheckout REJECTED: {query.invoice_payload}")


# ─── SUCCESSFUL PAYMENT ───────────────────────────────────────────────────────
async def successful_payment(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    payment = update.message.successful_payment
    user    = update.effective_user
    logger.info(f"PAYMENT RECEIVED: user={user.id} payload={payment.invoice_payload} amount={payment.total_amount}")

    try:
        parts = payment.invoice_payload.split("_")
        # payload: stars_{stars}_{coins}_{user_id}
        if len(parts) != 4 or parts[0] != "stars":
            raise ValueError(f"Bad payload format: {payment.invoice_payload}")
        stars = int(parts[1])
        coins = int(parts[2])
    except Exception as e:
        logger.error(f"Cannot parse payload: {payment.invoice_payload} — {e}")
        # Начисляем по факту оплаченных звёзд если payload сломан
        stars = payment.total_amount
        coins = stars
        logger.info(f"Fallback: crediting {coins} coins by total_amount")

    add_gold(user.id, coins)
    new_balance = get_gold(user.id)
    logger.info(f"Payment OK: user={user.id} stars={stars} +{coins} gold -> balance={new_balance}")
    record_transaction(user.id, user.username or "", user.full_name or "",
                       "deposit", "stars", coins, "gold")

    # Передаём баланс через startapp deeplink — WebApp читает параметр и обновляет баланс
    bot_username = (await ctx.bot.get_me()).username
    game_link = f"https://t.me/{bot_username}/GAME?startapp=gold_{new_balance}"

    await update.message.reply_text(
        f"✅ *Оплата прошла!*\n\n"
        f"⭐ Оплачено: *{stars} звёзд*\n"
        f"🟡 Начислено: *{coins} коинов*\n\n"
        f"💰 Баланс: *{new_balance} 🟡*\n\n"
        f"Нажми кнопку — коины зачислятся автоматически! 🎮",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("🎮 Открыть игру (+коины)", url=game_link)
        ]])
    )


# ─── /admin ───────────────────────────────────────────────────────────────────
async def admin(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if user.username != ADMIN_USERNAME:
        await update.message.reply_text("⛔ Доступ запрещён.")
        return ConversationHandler.END
    total = count_users()
    stats = get_transaction_stats()

    # Build summary text
    dep_stars, dep_usdt, dep_total = 0, 0, 0
    for row in stats["summary"]:
        ttype, method, amount, count = row
        if ttype == "deposit":
            dep_total += amount
            if method == "stars": dep_stars += amount
            elif method == "usdt": dep_usdt += amount

    summary_lines = [
        f"🛠 *Админ-панель FLEEP GIFT*",
        f"",
        f"👥 Пользователей: *{total}*",
        f"",
        f"💰 *Статистика пополнений:*",
        f"⭐ Через Stars: *{dep_stars} 🟡*",
        f"💵 Через USDT: *{dep_usdt} 🟡*",
        f"📊 Итого зачислено: *{dep_total} 🟡*",
        f"",
        f"📋 *Последние транзакции:*",
    ]
    for row in stats["recent"][:10]:
        ts, uname, fname, ttype, method, amount, currency = row
        date = ts[:10] if ts else "?"
        who = f"@{uname}" if uname else fname or "?"
        icon = "⬆️" if ttype == "deposit" else "⬇️"
        summary_lines.append(f"{icon} {date} {who}: {'+' if ttype=='deposit' else '-'}{amount} {currency} ({method})")

    keyboard = [
        [InlineKeyboardButton("📢 Рассылка", callback_data="adm_broadcast")],
        [InlineKeyboardButton("💰 Пополнить баланс пользователю", callback_data="adm_addbal")],
        [InlineKeyboardButton("📊 Подробная статистика", callback_data="adm_stats")],
    ]
    await update.message.reply_text(
        "\n".join(summary_lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return WAIT_BROADCAST_TEXT


async def admin_menu_choice(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "adm_broadcast":
        await query.message.reply_text("📢 Введи текст рассылки:")
        return WAIT_BROADCAST_TEXT

    if query.data == "adm_addbal":
        await query.message.reply_text(
            "💰 *Пополнение баланса*\n\nВведи username пользователя (можно с @):",
            parse_mode="Markdown"
        )
        return WAIT_ADDBAL_USER

    if query.data == "adm_stats":
        stats = get_transaction_stats()
        dep_stars = dep_usdt = dep_total = 0
        with_total = 0
        method_counts = {}
        for row in stats["summary"]:
            ttype, method, amount, cnt = row
            if ttype == "deposit":
                dep_total += amount
                if method == "stars": dep_stars += amount
                elif method == "usdt": dep_usdt += amount
            elif ttype == "withdrawal":
                with_total += amount
            key = f"{ttype}/{method}"
            method_counts[key] = method_counts.get(key, 0) + cnt

        lines = [
            "📊 *Полная статистика*",
            "",
            f"⭐ Stars пополнений: *{dep_stars} 🟡* ({method_counts.get('deposit/stars', 0)} шт)",
            f"💵 USDT пополнений: *{dep_usdt} 🟡* ({method_counts.get('deposit/usdt', 0)} шт)",
            f"📈 Итого зачислено: *{dep_total} 🟡*",
            f"📤 Выведено подарков: *{with_total} 🟡* ({method_counts.get('withdrawal/gift', 0)} шт)",
            "",
            "📋 *Последние 20 транзакций:*",
        ]
        for row in stats["recent"]:
            ts, uname, fname, ttype, method, amount, currency = row
            date = ts[:10] if ts else "?"
            who = f"@{uname}" if uname else (fname or "?")
            icon = "⬆️" if ttype == "deposit" else "⬇️"
            lines.append(f"{icon} {date} {who}: {'+' if ttype=='deposit' else '-'}{amount} {currency} via {method}")

        await query.message.reply_text("\n".join(lines), parse_mode="Markdown")
        return WAIT_BROADCAST_TEXT

    return ConversationHandler.END


# ─── ПОПОЛНЕНИЕ БАЛАНСА ПОЛЬЗОВАТЕЛЮ ─────────────────────────────────────────
async def addbal_receive_user(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    username = update.message.text.strip()
    row = find_user_by_username(username)
    if not row:
        await update.message.reply_text(
            f"❌ Пользователь *{username}* не найден.\n\n"
            f"Убедись что он запускал бота (/start).\n"
            f"Можно искать по username или по числовому Telegram ID:",
            parse_mode="Markdown"
        )
        return WAIT_ADDBAL_USER

    ctx.user_data["addbal_user_id"] = row[0]
    ctx.user_data["addbal_username"] = row[1] or username
    ctx.user_data["addbal_fullname"] = row[2] or ""
    gold, silver = get_balance(row[0])

    await update.message.reply_text(
        f"✅ Найден: *{row[2] or row[1]}* (@{row[1]})\n"
        f"💰 Баланс: 🟡 {gold} золота / ⚪ {silver} серебра\n\n"
        f"Введи сумму для пополнения (число):",
        parse_mode="Markdown"
    )
    return WAIT_ADDBAL_AMOUNT


async def addbal_receive_amount(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    try:
        amount = int(update.message.text.strip())
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("❌ Введи положительное число:")
        return WAIT_ADDBAL_AMOUNT

    ctx.user_data["addbal_amount"] = amount
    username = ctx.user_data.get("addbal_username", "?")

    keyboard = [[
        InlineKeyboardButton("🟡 Золото", callback_data="addbal_gold"),
        InlineKeyboardButton("⚪ Серебро", callback_data="addbal_silver"),
        InlineKeyboardButton("🟡+⚪ Оба", callback_data="addbal_both"),
    ]]
    await update.message.reply_text(
        f"Начислить *{amount}* — какой тип монет для @{username}?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return WAIT_ADDBAL_TYPE


async def addbal_confirm_type(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id  = ctx.user_data["addbal_user_id"]
    username = ctx.user_data["addbal_username"]
    amount   = ctx.user_data["addbal_amount"]
    coin_type = query.data  # addbal_gold / addbal_silver / addbal_both

    if coin_type == "addbal_gold":
        add_gold(user_id, amount)
        label = f"🟡 {amount} золота"
    elif coin_type == "addbal_silver":
        add_silver(user_id, amount)
        label = f"⚪ {amount} серебра"
    else:
        add_gold(user_id, amount)
        add_silver(user_id, amount)
        label = f"🟡 {amount} золота и ⚪ {amount} серебра"

    gold, silver = get_balance(user_id)

    await query.message.reply_text(
        f"✅ *Начислено!*\n\n"
        f"👤 @{username}\n"
        f"➕ {label}\n\n"
        f"💰 Новый баланс: 🟡 {gold} / ⚪ {silver}",
        parse_mode="Markdown"
    )

    # Уведомляем самого пользователя
    try:
        await ctx.bot.send_message(
            chat_id=user_id,
            text=f"🎁 *Тебе начислили {label}!*\n\n💰 Баланс: 🟡 {gold} / ⚪ {silver}",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("🎮 Открыть игру", url=WEB_APP_URL)
            ]])
        )
    except Exception as e:
        logger.warning(f"Cannot notify user {user_id}: {e}")

    return ConversationHandler.END


async def receive_broadcast_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data["broadcast_text"] = update.message.text
    await update.message.reply_text("✅ Текст сохранён.\n\nВведи *подпись кнопки*:", parse_mode="Markdown")
    return WAIT_BROADCAST_BTN


async def receive_broadcast_btn(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    label = update.message.text
    text  = ctx.user_data.get("broadcast_text", "")
    users = get_all_users()
    kb    = InlineKeyboardMarkup([[InlineKeyboardButton(label, url=WEB_APP_URL)]])
    ok = fail = 0
    await update.message.reply_text(f"📤 Рассылка на {len(users)} пользователей...")
    for uid in users:
        try:
            await ctx.bot.send_message(chat_id=uid, text=text, reply_markup=kb)
            ok += 1
        except Exception as e:
            logger.warning(f"Cannot send to {uid}: {e}")
            fail += 1
    await update.message.reply_text(
        f"✅ *Готово!*\n📬 Доставлено: {ok}\n❌ Ошибок: {fail}", parse_mode="Markdown"
    )
    return ConversationHandler.END


async def broadcast_cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Рассылка отменена.")
    return ConversationHandler.END


# ─── MAIN ─────────────────────────────────────────────────────────────────────
async def run():
    init_db()
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("balance", balance_cmd))

    # Диалог пополнения
    topup_conv = ConversationHandler(
        entry_points=[
            CommandHandler("topup", topup_start),
        ],
        states={
            WAIT_TOPUP_AMOUNT: [
                # Кнопки быстрого выбора пакета
                CallbackQueryHandler(topup_quick, pattern=r"^tq_(50|100|250|500|1000|custom)$"),
                # Текстовый ввод своей суммы
                MessageHandler(filters.TEXT & ~filters.COMMAND, topup_receive_amount),
            ],
            WAIT_TOPUP_PROMO: [
                CallbackQueryHandler(topup_promo_choice, pattern=r"^tq_(nopromo|haspromo)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, topup_receive_promo),
            ],
        },
        fallbacks=[CommandHandler("cancel", topup_cancel)],
        per_message=False,
    )
    # ⚠️ Платежи регистрируем ДО ConversationHandler'ов — иначе могут перехватываться
    app.add_handler(PreCheckoutQueryHandler(pre_checkout))
    app.add_handler(MessageHandler(filters.SUCCESSFUL_PAYMENT, successful_payment))

    app.add_handler(topup_conv)

    # Рассылка + пополнение баланса
    admin_conv = ConversationHandler(
        entry_points=[CommandHandler("admin", admin)],
        states={
            WAIT_BROADCAST_TEXT: [
                CallbackQueryHandler(admin_menu_choice, pattern=r"^adm_(broadcast|addbal|stats)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_broadcast_text),
            ],
            WAIT_BROADCAST_BTN:  [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_broadcast_btn)],
            WAIT_ADDBAL_USER:    [MessageHandler(filters.TEXT & ~filters.COMMAND, addbal_receive_user)],
            WAIT_ADDBAL_AMOUNT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, addbal_receive_amount)],
            WAIT_ADDBAL_TYPE:    [CallbackQueryHandler(addbal_confirm_type, pattern=r"^addbal_(gold|silver|both)$")],
        },
        fallbacks=[CommandHandler("cancel", broadcast_cancel)],
        per_message=False,
    )
    app.add_handler(admin_conv)

    logger.info("Бот запускается…")
    async with app:
        await app.initialize()
        await app.start()
        # Запускаем HTTP ПОСЛЕ инициализации бота — иначе create_invoice_link упадёт
        if PORT:
            await start_http(app)
        logger.info("Бот и HTTP запущены!")
        await app.updater.start_polling()
        await asyncio.Event().wait()


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()

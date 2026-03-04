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
) = range(4)

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
            gold_coins INTEGER NOT NULL DEFAULT 0
        )
    """)
    try:
        conn.execute("ALTER TABLE users ADD COLUMN gold_coins INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass
    conn.commit()
    conn.close()


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
    # INSERT если пользователя ещё нет в БД (на случай если /start не вызывался)
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

    if not verify_init_data(init_data):
        return web.json_response({"error": "unauthorized"}, status=403, headers=CORS)

    gold = get_gold(int(user_id))
    return web.json_response({"gold_coins": gold}, headers=CORS)


async def http_health(request: web.Request) -> web.Response:
    return web.Response(text="OK")


async def start_http():
    app_http = web.Application()
    app_http.router.add_get("/",        http_health)
    app_http.router.add_get("/balance", http_balance)
    app_http.router.add_options("/balance", http_balance)
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
    await update.message.reply_text(
        f"🛠 *Админ-панель FLEEP GIFT*\n\n👥 Пользователей: *{total}*\n\nВведи текст рассылки:",
        parse_mode="Markdown"
    )
    return WAIT_BROADCAST_TEXT


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

    # Рассылка
    admin_conv = ConversationHandler(
        entry_points=[CommandHandler("admin", admin)],
        states={
            WAIT_BROADCAST_TEXT: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_broadcast_text)],
            WAIT_BROADCAST_BTN:  [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_broadcast_btn)],
        },
        fallbacks=[CommandHandler("cancel", broadcast_cancel)],
    )
    app.add_handler(admin_conv)

    # Запускаем HTTP только если PORT задан (Railway/Render)
    if PORT:
        await start_http()

    logger.info("Бот запущен!")
    async with app:
        await app.initialize()
        await app.start()
        await app.updater.start_polling()
        await asyncio.Event().wait()


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()

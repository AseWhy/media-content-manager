import { Container } from "typedi";

import TelegramBot, { Message } from "node-telegram-bot-api";

/** Бот */
const BOT = Container.get(TelegramBot);

/**
 * Обрабатывает стартовое сообщение
 * @param msg сообщение
 */
export async function start(msg: Message) {
    await BOT.sendMessage(msg.chat.id, `Отправь мне магнутную ссылку, или пришли торрент файл, чтобы я его загрузил!`);
}
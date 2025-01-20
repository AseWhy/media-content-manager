import 'reflect-metadata';
import './context';

import { Container } from "typedi";
import { BOT_ALLOWED_USER_IDS, BOT_TOKEN, CONFIG, DOWNLOAD_LIMIT, MANAGED_DIR } from "./constants";
import { filesDelete, KEYBOARD_PREFIX as DELETE_FILES_KEYBOARD_PREFIX, filesDeleteConfirmed } from "./listeners/filesDelete";
import { filesList, filesListPagable, KEYBOARD_PREFIX as LIST_FILES_KEYBOARD_PREFIX } from "./listeners/filesList";
import { filesMove, filesMovePagable, KEYBOARD_PREFIX as MOVE_FILES_KEYBOARD_PREFIX } from "./listeners/filesMove";
import { filesRename } from "./listeners/filesRename";
import { start } from "./listeners/start";
import { upload } from "./listeners/upload";
import { ProcessingService } from "./service/processing/processingService";
import { ChatStateManager } from './service/telegram/chatStateManager';

import TelegramBot from 'node-telegram-bot-api';

// Выводим значения переменных
console.log("MANAGED_DIR", "\t\t", MANAGED_DIR);
console.log("BOT_TOKEN", "\t\t", BOT_TOKEN);
console.log("DOWNLOAD_LIMIT", "\t\t", DOWNLOAD_LIMIT);
console.log("BOT_ALLOWED_USER_IDS", "\t", BOT_ALLOWED_USER_IDS);
console.log("CONFIG", "\t", CONFIG);

/** Telegram бот */
const BOT = Container.get(TelegramBot);

/** Менеджер состояния */
const STATE_MANAGER = Container.get(ChatStateManager);

/** Сервис постобработки */
const PROCESSING_SERVICE = Container.get(ProcessingService);

// Действие при получении колбэка
BOT.on("callback_query", async query => {
    const message = query.message;
    if (message) {
        const dataSplit = query.data?.split(":") ?? [];
        switch (dataSplit[0]) {
            case LIST_FILES_KEYBOARD_PREFIX: await filesListPagable(message.chat.id, message.message_id, parseInt(dataSplit[1])); break;
            case MOVE_FILES_KEYBOARD_PREFIX: await filesMovePagable(message.chat.id, message.message_id, parseInt(dataSplit[1])); break;
            case DELETE_FILES_KEYBOARD_PREFIX: await filesDeleteConfirmed(message.chat.id, message.message_id, parseInt(dataSplit[1])); break;
        }
    }
});

// Действие при получении сообщения
BOT.on("message", async msg => {
    const fromId = msg.from?.id ?? 0;
    if (BOT_ALLOWED_USER_IDS.includes(fromId)) {
        const text = msg.text;
        if (text == null || msg.document || text.match(/(magnet:[aA-zZ?=:0-9&.+_\/%]+)/g)) {
            await upload(msg);
        } else {
            const splitMessage = text.split("_");
            switch(splitMessage[0]) {
                case "/start": await start(msg); break;
                case "/files": await filesList(msg.chat.id, text.split(" ", 2)[1]); break;
                case "/delete": await filesDelete(msg, splitMessage); break;
                case "/rename": await filesRename(msg, splitMessage); break;
                case "/move": await filesMove(msg, splitMessage); break;
                default: STATE_MANAGER.process(msg); break;
            }
        }
    } else {
        await BOT.sendMessage(msg.chat.id, `Ваш id: ${fromId}!`);
    }
});

// Инициализируем
PROCESSING_SERVICE.init();

/** Устанавливаем список комманд */
BOT.setMyCommands([
    {
        command: "/files",
        description: "Отображает список файлов"
    }
], { language_code: "ru" });
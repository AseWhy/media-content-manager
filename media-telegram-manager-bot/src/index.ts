import 'reflect-metadata';
import './context';

import { Container } from "typedi";
import { BOT_ALLOWED_USER_IDS, BOT_TOKEN, CONFIG, DOWNLOAD_DIR, DOWNLOAD_LIMIT, FilesListMode, MANAGED_DIR, PROCESSOR_DIR, PULL_INTERVAL } from "@const";
import { filesDelete, KEYBOARD_PREFIX as DELETE_FILES_KEYBOARD_PREFIX, filesDeleteConfirmed } from "@listeners/filesDelete";
import { FILES_LIST_MODE_PREFIX, filesList, filesListMode, filesListPagable, KEYBOARD_PREFIX as LIST_FILES_KEYBOARD_PREFIX } from "@listeners/filesList";
import { filesMove, filesMovePagable, KEYBOARD_PREFIX as MOVE_FILES_KEYBOARD_PREFIX } from "@listeners/filesMove";
import { panel } from '@listeners/panel';
import { filesRename } from "@listeners/filesRename";
import { start } from "@listeners/start";
import { upload } from "@listeners/upload";
import { ProcessingService } from "@service/processing/processingService";
import { ChatStateManager } from '@service/telegram/chatStateManager';

import TelegramBot from 'node-telegram-bot-api';
import EventEmitter from 'events';
import _ from 'lodash';

// Выводим значения переменных
console.log("MANAGED_DIR", "\t\t", MANAGED_DIR);
console.log("DOWNLOAD_DIR", "\t\t", DOWNLOAD_DIR);
console.log("PROCESSOR_DIR", "\t\t", PROCESSOR_DIR);
console.log("PULL_INTERVAL", "\t\t", PULL_INTERVAL);
console.log("BOT_TOKEN", "\t\t", BOT_TOKEN.replace(/./g, '*'));
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
        const dataSplit = query.data?.split(":", 2) ?? [];
        switch (dataSplit[0]) {
            case LIST_FILES_KEYBOARD_PREFIX:
                await filesListPagable(message.chat.id, message.message_id, parseInt(dataSplit[1]));
            break;
            case FILES_LIST_MODE_PREFIX:
                await filesListMode(message.chat.id, message.message_id, dataSplit[1].split(";")
                    .filter(e => !_.isEmpty(e)) as FilesListMode[]);
            break;
            case MOVE_FILES_KEYBOARD_PREFIX:
                await filesMovePagable(message.chat.id, message.message_id, parseInt(dataSplit[1]));
            break;
            case DELETE_FILES_KEYBOARD_PREFIX:
                await filesDeleteConfirmed(message.chat.id, message.message_id, parseInt(dataSplit[1]));
            break;
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
            const splitMessage = text.split(/[_ ]+/g);
            switch(splitMessage[0]) {
                case "/start":
                    await start(msg);
                break;
                case "/files":
                    await filesList(msg.chat.id, splitMessage);
                break;
                case "/delete":
                    await filesDelete(msg, splitMessage);
                break;
                case "/panel":
                    panel(msg.chat.id);
                break;
                case "/rename":
                    await filesRename(msg, splitMessage);
                break;
                case "/move":
                    await filesMove(msg, splitMessage);
                break;
                default:
                    STATE_MANAGER.process(msg);
                break;
            }
        }
    } else {
        await BOT.sendMessage(msg.chat.id, `Ваш id: ${fromId}!`);
    }
});

/** Устанавливаем список комманд */
BOT.setMyCommands([
    {
        command: "/files",
        description: "Отображает список файлов"
    },
    {
        command: "/panel",
        description: "Выводит панель в последнем сообщении текущего чата"
    }
], { language_code: "ru" });

// Инициализируем
PROCESSING_SERVICE.init();

// Устанавливаем максимальное количество слушателей
EventEmitter.setMaxListeners(100);
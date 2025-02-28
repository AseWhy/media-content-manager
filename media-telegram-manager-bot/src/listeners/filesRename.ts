import { StorageManager } from "@service/storageManager";
import { parse } from "path";
import { cancelable } from "@service";
import { getCurrentFileList } from "@listeners/filesList";
import { Container } from "typedi";
import { ChatStateManager } from "@service/telegram/chatStateManager";

import TelegramBot, { Message } from "node-telegram-bot-api";

/** Менеджер состояния чата */
const STATE_MANAGER = Container.get(ChatStateManager);

/** Бот */
const BOT = Container.get(TelegramBot);

/** Менеджер хранилища */
const STORAGE_MANAGER = Container.get(StorageManager);

/** Сообщение "Переименование отменено!" */
const MESSAGE_RENAME_CANCEL = "Переименование отменено!";

/** Сообщение "Индекс файла должен быть передан!" */
const MESSAGE_FILE_ID_NOT_PASSED = "Индекс файла должен быть передан!";

/** Сообщение ввода нового местоположения */
const MESSAGE_ENTER_NEW_LOCATION = cancelable("Введите новое наименование файла без расширения.");

/**
 * Обрабатывает удаление файла
 * @param msg сообщение
 */
export async function filesRename(msg: Message, splitCommand: string[]) {
    const chatId = msg.chat.id;
    const { files } = getCurrentFileList(chatId);
    const fileId = splitCommand[1];

    if (fileId == null) {
        BOT.sendMessage(chatId, MESSAGE_FILE_ID_NOT_PASSED);
    }

    const file = files[parseInt(fileId)];
    const { name } = parse(file.path);

    await BOT.sendMessage(chatId, cancelable(`Переименование файла <code>${name}</code>. ${MESSAGE_ENTER_NEW_LOCATION}`),
        { parse_mode: "HTML" });

    STATE_MANAGER.state(chatId, "file_rename", { file, name });
}

// Слушаем обновление состояния
STATE_MANAGER.on("state:file_rename", async ({ file, name }, { chatId, message }) => {
    if (message === '/cancel') {
        await BOT.sendMessage(chatId, MESSAGE_RENAME_CANCEL);
        STATE_MANAGER.flush(chatId);
        return;
    }

    if (message == null) {
        await BOT.sendMessage(chatId, MESSAGE_ENTER_NEW_LOCATION);
    } else {
        await STORAGE_MANAGER.rename(file.path, message);
        await BOT.sendMessage(chatId, `Файл <code>${name}</code> успешно переименован в <code>${message}</code>!`, 
            { parse_mode: "HTML" });

        STATE_MANAGER.flush(chatId);
    }
});
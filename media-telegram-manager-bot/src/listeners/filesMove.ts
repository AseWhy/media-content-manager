import { FileData, StorageManager } from "@service/storageManager";
import { basename, join, parse } from "path";
import { cancelable, listContent } from "@service";
import { makePaginationKeyboard } from "@service/keyboard";
import { getCurrentFileList } from "@listeners/filesList";
import { Container } from "typedi";
import { ChatStateManager } from "@service/telegram/chatStateManager";

import TelegramBot, { ChatId, Message } from "node-telegram-bot-api";

/** Менеджер состояния чата */
const STATE_MANAGER = Container.get(ChatStateManager);

/** Бот */
const BOT = Container.get(TelegramBot);

/** Менеджер хранилища */
const STORAGE_MANAGER = Container.get(StorageManager);

/** Размер страницы с файлами */
const PAGE_SIZE = 15;

/** Префикс действий на клавиатуре */
export const KEYBOARD_PREFIX = "file_move";

/** Сообщение "Перемещение отменено!" */
const MESSAGE_MOVE_CANCEL = "Перемещение отменено!";

/** Сообщение "Индекс файла должен быть передан!" */
const MESSAGE_FILE_ID_NOT_PASSED = "Индекс файла должен быть передан!";

/** Сообщение "Индекс локации должен быть передан!" */
const MESSAGE_LOCATION_ID_NOT_PASSED = "Индекс локации должен быть передан!";

/** Сообщение выбора нового местоположения файла */
const MESSAGE_SELECT_MOVE_LOCATION = cancelable(`Выберите директорию для перемещения файла`);

/**
 * Обрабатывает удаление файла
 * @param msg сообщение
 */
export async function filesMove(msg: Message, splitCommand: string[]) {
    const chatId = msg.chat.id;
    const { files } = getCurrentFileList(chatId);
    const fileId = splitCommand[1];

    if (fileId == null) {
        await BOT.sendMessage(chatId, MESSAGE_FILE_ID_NOT_PASSED);
    } else {
        const file = files[parseInt(fileId)];
        const locations = await STORAGE_MANAGER.filesList(stat => stat.isDirectory());
        const target = basename(file.path);
    
        await BOT.sendMessage(chatId, createMessage(target, locations), { parse_mode: "HTML", reply_markup: {
            inline_keyboard: [
                makePaginationKeyboard(KEYBOARD_PREFIX, 0, Math.trunc(locations.length / PAGE_SIZE))
            ]
        }});
    
        STATE_MANAGER.state(chatId, "file_move", { file, target, locations })
    }
}

/**
 * Обрабатывает переключение страницы пагинации директории для перемещения файла
 * @param chatId    идентификатор чата
 * @param messageId идентификатор сообщения
 * @param [page=0]  страница
 */
export async function filesMovePagable(chatId: ChatId, messageId: number, page: number = 0) {
    const { data: { target, locations } } = STATE_MANAGER.getState(chatId);
    await BOT.editMessageText(createMessage(target, locations, page), { reply_markup: {
        inline_keyboard: [
            makePaginationKeyboard(KEYBOARD_PREFIX, page, Math.trunc(locations.length / PAGE_SIZE))
        ]
    }, chat_id: chatId, message_id: messageId, parse_mode: "HTML" })
}

// Слушаем обновление состояния
STATE_MANAGER.on("state:file_move", async ({ file, locations }, { chatId, message }) => {
    if (message == null) {
        await BOT.sendMessage(chatId, MESSAGE_SELECT_MOVE_LOCATION);
    } else {
        const splitMessage = message.split("_");
        switch (splitMessage[0]) {
            case "/moveFileTo":
                if (splitMessage[1] == null) {
                    await BOT.sendMessage(chatId, MESSAGE_LOCATION_ID_NOT_PASSED);
                } else {
                    const locationIndex = parseInt(splitMessage[1]);

                    const { path } = locations[locationIndex];
                    const { name, ext } = parse(file.path);

                    await STORAGE_MANAGER.move(file.path, join(path, name + ext));
                    await BOT.sendMessage(chatId, `Файл <code>${name} [${file.size}]</code> успешно перемещен в <code>${path}</code>!`, 
                        { parse_mode: "HTML" });
                }
                break;
            case "/cancel":
                await BOT.sendMessage(chatId, MESSAGE_MOVE_CANCEL);
            break;
            default:
                await BOT.sendMessage(chatId, `Неизвестная команда`);
            return;
        }
        STATE_MANAGER.flush(chatId);
    }
});

/**
 * Формирует сообщение
 * @param files список файлов
 * @param page  страница
 * @returns сообщение пользователю
 */
function createMessage(target: string, files: FileData[], page: number = 0): string {
    const firstIndex = page * PAGE_SIZE;
    return cancelable(listContent(
        `Перемещение файла <code>${target}</code>. Выберите новое местоположение файла`,
        files.slice(firstIndex, firstIndex + PAGE_SIZE),
        (file, index) => {
            return `<code>${file.path}</code> [/moveFileTo_${firstIndex + index}]`;
        }
    ));
}
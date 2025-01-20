import { makePaginationKeyboard } from "../service/keyboard";
import { FileData, StorageManager } from "../service/storageManager";
import { listContent } from "../service";
import { getChatData, updateChatData } from "../service/database";
import { Container } from "typedi";

import TelegramBot, { ChatId } from "node-telegram-bot-api";
import humanFormat from "human-format";

/** Бот */
const BOT = Container.get(TelegramBot);

/** Менеджер хранилища */
const STORAGE_MANAGER = Container.get(StorageManager);

/** Размер страницы с файлами */
const PAGE_SIZE = 15;

/** Префикс действий на клавиатуре */
export const KEYBOARD_PREFIX = "file_list";

/** Ключ данных чата списка файлов */
export const FILES_LIST_CHAT_DATA = "filesList";

/**
 * Обрабатывает получение списка файлов
 * @param chatId идентификатор чата
 * @param filter фильтр файлов
 */
export async function filesList(chatId: ChatId, filter: string) {
    const pattern = new RegExp(filter);
    const files = await STORAGE_MANAGER.filesList((_, path) => !!path.match(pattern));
    updateChatData(chatId, FILES_LIST_CHAT_DATA, files);
    await BOT.sendMessage(chatId, createMessage(files, 0), { ...makePaginationKeyboard(KEYBOARD_PREFIX, 0, Math.trunc(files.length / PAGE_SIZE)),
        parse_mode: "HTML" });
}

/**
 * Обрабатывает переключение страницы пагинации файлов
 * @param chatId    идентификатор чата
 * @param messageId идентификатор сообщения
 * @param [page=0]  страница
 */
export async function filesListPagable(chatId: ChatId, messageId: number, page: number = 0) {
    const files = getChatData<FileData[]>(chatId, FILES_LIST_CHAT_DATA);
    await BOT.editMessageText(createMessage(files, page), { ...makePaginationKeyboard(KEYBOARD_PREFIX, page, Math.trunc(files.length / PAGE_SIZE)),
        chat_id: chatId, message_id: messageId, parse_mode: "HTML" });
}

/**
 * Формирует сообщение
 * @param files    список файлов
 * @param [page=0] страница
 * @returns сообщение пользователю
 */
function createMessage(files: FileData[], page: number = 0): string {
    const firstIndex = page * PAGE_SIZE;
    return listContent(`Список файлов. Всего ${files.length} файлов и папок, размером ${humanFormat(files.map(e => e.size).reduce((a, b) => a + b, 0))}`, files.slice(firstIndex, firstIndex + PAGE_SIZE), (file, index) => {
        const completedIndex = firstIndex + index;
        const result = [ `<code>/${file.path} [${humanFormat(file.size)}]</code>` ];
        if (file.isFile) {
            result.push(`[/delete_${completedIndex}] [/rename_${completedIndex}] [/move_${completedIndex}]\n`);
        } else {
            result.push(`[/delete_${completedIndex}] [/rename_${completedIndex}]\n`);
        }
        return result;
    })
}
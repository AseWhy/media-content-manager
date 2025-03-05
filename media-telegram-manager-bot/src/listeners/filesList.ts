import { makeFileListModeKeyboard, makePaginationKeyboard } from "@service/keyboard";
import { FileData, StorageManager } from "@service/storageManager";
import { listContent } from "@service";
import { Container } from "typedi";
import { CONFIG, FilesListMode } from "@const";
import { Files } from "@service/files";

import TelegramBot, { ChatId } from "node-telegram-bot-api";
import humanFormat from "human-format";

/** Бот */
const BOT = Container.get(TelegramBot);

/** Бот */
const STORAGE_MANAGER = Container.get(StorageManager);

/** Размер страницы с файлами */
const PAGE_SIZE = 15;

/** Префикс действий на клавиатуре */
export const KEYBOARD_PREFIX = "file_list";

/** Префикс действий на клавиатуре переключения режима */
export const FILES_LIST_MODE_PREFIX = "file_list_mode";


/**
 * Обрабатывает получение списка файлов
 * @param chatId идентификатор чата
 * @param filter фильтр файлов
 */
export async function filesList(chatId: ChatId, splitCommand: string[]) {
    const pattern = splitCommand[1] ? new RegExp(splitCommand[1]) : getDefaultRegexpPattern();
    const files = new Files(chatId);
    files.files = await STORAGE_MANAGER.filesList((stat, path) => stat.isDirectory() || !!path.match(pattern));
    await BOT.sendMessage(chatId, createMessage(files.files, 0, files.modes), { reply_markup: { inline_keyboard: [
        makePaginationKeyboard(KEYBOARD_PREFIX, 0, Math.trunc(files.files.length / PAGE_SIZE)),
        makeFileListModeKeyboard(FILES_LIST_MODE_PREFIX, files.modes)
    ] }, parse_mode: "HTML" });
}

/**
 * Обрабатывает переключение страницы пагинации файлов
 * @param chatId    идентификатор чата
 * @param messageId идентификатор сообщения
 * @param [page=0]  страница
 */
export async function filesListPagable(chatId: ChatId, messageId: number, page: number = 0) {
    const files = new Files(chatId);
    files.page = page;
    await BOT.editMessageText(createMessage(files.files, page, files.modes), { reply_markup: {
        inline_keyboard: [
            makePaginationKeyboard(KEYBOARD_PREFIX, page, Math.trunc(files.files.length / PAGE_SIZE)),
            makeFileListModeKeyboard(FILES_LIST_MODE_PREFIX, files.modes)
        ]
    }, chat_id: chatId, message_id: messageId, parse_mode: "HTML" });
}

/**
 * Обрабатывает переключение страницы пагинации файлов
 * @param chatId     идентификатор чата
 * @param messageId  идентификатор сообщения
 * @param [modes=[]] режимы отображения файлов
 */
export async function filesListMode(chatId: ChatId, messageId: number, modes: FilesListMode[] = []) {
    const files = new Files(chatId);
    files.modes = modes;
    await BOT.editMessageText(createMessage(files.files, files.page, modes), { reply_markup: {
        inline_keyboard: [
            makePaginationKeyboard(KEYBOARD_PREFIX, files.page, Math.trunc(files.files.length / PAGE_SIZE)),
            makeFileListModeKeyboard(FILES_LIST_MODE_PREFIX, modes)
        ]
    }, chat_id: chatId, message_id: messageId, parse_mode: "HTML" });
}

/**
 * Формирует сообщение
 * @param files    список файлов
 * @param [page=0] страница
 * @returns сообщение пользователю
 */
function createMessage(files: FileData[], page: number = 0, modes: FilesListMode[]): string {
    const firstIndex = page * PAGE_SIZE;
    const filesToDisplay = files.slice(firstIndex, firstIndex + PAGE_SIZE);
    const filesSize = humanFormat(files.map(e => e.size).reduce((a, b) => a + b, 0));

    return listContent(`Список файлов. Отображается ${filesToDisplay.length} из ${files.length} файлов и папок, размером ${filesSize}.`, filesToDisplay,
        (file, index) => {
            const result = [ `<code>/${file.path} [${humanFormat(file.size)}]</code>` ];
            const completedIndex = firstIndex + index;
            if (file.isFile) {
                result.push(`[/delete_${completedIndex}] [/rename_${completedIndex}] [/move_${completedIndex}]\n`);
            } else {
                result.push(`[/delete_${completedIndex}] [/rename_${completedIndex}]\n`);
            }
            return result;
        });
}

/**
 * Возвращает шаблон файлов RegExp по умолчанию
 * @returns шаблон файлов RegExp по умолчанию
 */
function getDefaultRegexpPattern(): RegExp {
    const extensions: string[] = [];
    for (const config of Object.values(CONFIG.categories)) {
        extensions.push(...config.ext);
    }
    return new RegExp(`(${extensions.map(extension => extension.replace(".", "\\.")).join("|")})$`)
}
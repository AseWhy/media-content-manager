import { EditMessageTextOptions, InlineKeyboardButton, SendMessageOptions } from "node-telegram-bot-api";
import { FilesListMode } from "@const";

import _ from "lodash";

/**
 * Создает клавиатуру подтверждения
 * @param prefix  префикс
 * @param payload полезная нагрузка
 * @returns корневая клавиатура
 */
export function makeConfirmationKeyboard(prefix: string, payload: string): SendMessageOptions & EditMessageTextOptions {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "Подтвердить", callback_data: `${prefix}:${payload}` }
                ]
            ]
        }
    }
}

/**
 * Создает клавиатуру пагинации
 * @param prefix префикс
 * @param page   текущая страница
 * @param total  всего страниц
 * @returns корневая клавиатура
 */
export function makePaginationKeyboard(prefix: string, page: number, total: number): InlineKeyboardButton[] {
    const inline_keyboard: InlineKeyboardButton[] = [];
    if (page > 0) {
        inline_keyboard.push(
            { text: "<<", callback_data: `${prefix}:0` },
            { text: "<", callback_data: `${prefix}:${page - 1}` },
        );
    }
    if (page < total) {
        inline_keyboard.push(
            { text: ">", callback_data: `${prefix}:${page + 1}` },
            { text: ">>", callback_data: `${prefix}:${total}` }
        )
    }
    return inline_keyboard;
}

/**
 * Создает клавиатуру выбора режима списка файлов
 * @param prefix       префикс
 * @param currentModes массив выбранных режимов отображения
 * @returns клавиатуру переключения режима отображения файлов
 */
export function makeFileListModeKeyboard(prefix: string, currentModes: Array<FilesListMode>) {
    return [
        { text: "Отображать файлы" + (currentModes.includes("files") ? " ✅" : ""), callback_data: `${prefix}:${
            (currentModes.includes("files") ? _.filter(currentModes, e => e !== "files") :
                _.uniq([ ...currentModes, "files" ])).join(";")}` },
        { text: "Отображать папки" + (currentModes.includes("directories") ? " ✅" : ""), callback_data: `${prefix}:${
            (currentModes.includes("directories") ? _.filter(currentModes, e => e !== "directories") :
                _.uniq([ ...currentModes, "directories" ])).join(";")}` }
    ]
}

/**
 * Создает опции удлаения клавиатуры
 * @returns опции удаления клавиатуры
 */
export function makeRemoveKeyboard(): SendMessageOptions {
    return { reply_markup: { remove_keyboard: true } };
}
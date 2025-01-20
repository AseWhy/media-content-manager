import { EditMessageTextOptions, InlineKeyboardButton, SendMessageOptions } from "node-telegram-bot-api";

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
export function makePaginationKeyboard(prefix: string, page: number, total: number): SendMessageOptions & EditMessageTextOptions {
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
    return {reply_markup: { inline_keyboard: [ inline_keyboard ] }}
}

/**
 * Создает опции удлаения клавиатуры
 * @returns опции удаления клавиатуры
 */
export function makeRemoveKeyboard(): SendMessageOptions {
    return { reply_markup: { remove_keyboard: true } };
}
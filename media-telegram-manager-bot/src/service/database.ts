import { FSDB } from "file-system-db";
import { ChatId } from "node-telegram-bot-api";

/** Хранилище в файловой системе */
const FILE_SYSTEM_DB = new FSDB("./data/data.json", false);

/**
 * Обновляет данные чата
 * @param chatId   идентификатор чата
 * @param category категория данных
 * @param data     данные чата
 */
export function updateChatData(chatId: ChatId, category: string, data: any) {
    updateData(chatId.toString() + ":" + category, data);
}

/**
 * Возвращает данные чата
 * @param chatId   идентификатор чата
 * @param category категория данных
 * @returns данные чата
 */
export function getChatData<T>(chatId: ChatId, category: string, def?: T): T {
    return getData(chatId.toString() + ":" + category, def);
}

/**
 * Удаляет данные чата
 * @param chatId   идентификатор чата
 * @param category категория данных
 */
export function deleteChatData(chatId: ChatId, category: string) {
    deleteData(chatId.toString() + ":" + category);
}

/**
 * Обновляет данные чата
 * @param category категория данных
 * @param data     данные чата
 */
export function updateData(category: string, data: any) {
    FILE_SYSTEM_DB.set(category, data);
}

/**
 * Возвращает данные чата
 * @param category категория данных
 * @returns данные чата
 */
export function getData<T>(category: string, def?: T): T {
    return FILE_SYSTEM_DB.get(category) ?? def;
}

/**
 * Удаляет данные чата
 * @param category категория данных
 */
export function deleteData(category: string) {
    FILE_SYSTEM_DB.delete(category);
}

/**
 * Возвращает все вхождения базы данных
 * @param category категория данных
 * @returns все вхождения базы данных
 */
export function getAll(category: string) {
    return FILE_SYSTEM_DB.getAll().filter(e => e.key.endsWith(category));
}
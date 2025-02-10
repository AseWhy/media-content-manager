import { FileData, StorageManager } from "@service/storageManager";
import { makeConfirmationKeyboard } from "@service/keyboard";
import { getChatData } from "@service/database";
import { FILES_LIST_CHAT_DATA } from "@listeners/filesList";
import { Container } from "typedi";

import TelegramBot, { ChatId, Message } from "node-telegram-bot-api";

/** Бот */
const BOT = Container.get(TelegramBot);

/** Менеджер хранилища */
const STORAGE_MANAGER = Container.get(StorageManager);

/** Префикс действий на клавиатуре */
export const KEYBOARD_PREFIX = "file_delete";

/** Сообщение "Индекс файла должен быть передан!" */
const MESSAGE_FILE_ID_NOT_PASSED = "Индекс файла должен быть передан!";

/**
 * Обрабатывает удаление файла
 * @param msg сообщение
 */
export async function filesDelete(msg: Message, splitCommand: string[]) {
    const chatId = msg.chat.id;
    const files = getChatData<FileData[]>(chatId, FILES_LIST_CHAT_DATA);
    const fileId = splitCommand[1];

    if (fileId == null) {
        BOT.sendMessage(chatId, MESSAGE_FILE_ID_NOT_PASSED);
    }

    const file = files[parseInt(fileId)];

    await BOT.sendMessage(chatId, `Вы уверены, что хотите удалить файл <code>${file.path}</code>?`, {
        ...makeConfirmationKeyboard(KEYBOARD_PREFIX, fileId), parse_mode: "HTML" });
}

/**
 * Подтверждает удаление файла
 * @param chatId    идентификатор чата
 * @param messageId идентификатор сообщения
 * @param fileId    идентификатор файла
 */
export async function filesDeleteConfirmed(chatId: ChatId, messageId: number, fileId: number) {
    const files = getChatData<FileData[]>(chatId, FILES_LIST_CHAT_DATA);
    const file = files[fileId];

    await STORAGE_MANAGER.delete(file.path);
    await BOT.editMessageText(`Файл <code>${file.path}]</code> успешно удален!`,
        { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [] }});
}
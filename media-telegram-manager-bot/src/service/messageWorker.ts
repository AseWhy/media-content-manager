import { deleteChatData, getChatData, updateChatData } from "./database";
import { Container } from "typedi";

import TelegramBot, { ChatId, EditMessageTextOptions, SendMessageOptions } from "node-telegram-bot-api";

/** Категория данных последнего отправленного сообщения */
const LAST_MESSAGE_CATEGORY = "lastMessage";

/**
 * Данные последнего отправленного сообщения
 */
type LastMessageData = {
    /** Идентификатор последнего сообщения */
    lastMessageId: number;
    /** Содержимое предыдущего сообщения */
    lastMessage: string;
}

/**
 * Класс для работы с одним сообщением
 */
export class MessageWorker {

    /** Идентификатор последнего сообщения */
    private _lastMessage: LastMessageData | null = null;

    /**
     * Конструктор
     * @param _chatId               идентификатор чата
     * @param _bot                  бот 
     * @param _useLastMessage       признак необходимости использовать последнее отправленное сообщение в этом чате
     * @param _defaultMessageParams параметры по умолчанию для отправки и редактирования сообщения
     */
    constructor(private _chatId: ChatId, private _useLastMessage: boolean = false,
        private readonly _defaultMessageParams: SendMessageOptions & EditMessageTextOptions = {}) {
        if (_useLastMessage) {
            this._lastMessage = getChatData(_chatId, LAST_MESSAGE_CATEGORY, null);
        }
    }

    /**
     * Отправляет новое или редактирует ранее отправленное сообщение
     * @param message сообщение для отправки
     */
    public async send(message: string): Promise<number> {
        const params = Object.assign({ parse_mode: "MarkdownV2" }, this._defaultMessageParams);
        const bot = Container.get(TelegramBot);
        if (this._lastMessage) {
            if (this._lastMessage.lastMessage === message) {
                return this._lastMessage.lastMessageId;
            }
            await bot.editMessageText(message, { ...params, message_id: this._lastMessage.lastMessageId, chat_id: this._chatId });
            // Обновляем последнее отправленное сообщение
            this._lastMessage.lastMessage = message;
        } else {
            const sendMessage = await bot.sendMessage(this._chatId, message, params);
            this._lastMessage = { lastMessageId: sendMessage.message_id, lastMessage: message };
        }
        if (this._useLastMessage) {
            updateChatData(this._chatId, LAST_MESSAGE_CATEGORY, this._lastMessage);
        }
        return this._lastMessage.lastMessageId;
    }

    /**
     * Забыть последнее отправленное сообщение
     */
    public forgetLastMessage() {
        if (this._lastMessage && this._useLastMessage) {
            deleteChatData(this._chatId, LAST_MESSAGE_CATEGORY);
            this._lastMessage = null;
        }
    }
}
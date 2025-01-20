import { ChatId, Message } from "node-telegram-bot-api";
import { getChatData, updateChatData } from "../database";
import { Service } from "typedi";

import EventEmitter from "events";

/** Состояние отсутствия состояния */
const NO_STATE: ComposedState = { state: "no-state", data: null };

/** Состояние чата */
type ComposedState = {
    /** Наименование состояния */
    state: string;
    /** Данные состояния */
    data: any;
}

/**
 * Менеджер состояния чата
 */
@Service()
export class ChatStateManager extends EventEmitter {

    /**
     * Переключает состояние чата
     * @param chatId   идентификатор чата
     * @param newState новое состояние чата
     */
    public state(chatId: ChatId, newState: string, data: any = null) {
        updateChatData(chatId, "state", { state: newState, data });
    }
    
    /**
     * Очищает состояние чата
     * @param chatId   идентификатор чата
     * @param newState новое состояние чата
     */
    public flush(chatId: ChatId) {
        updateChatData(chatId, "state", NO_STATE);
    }

    /**
     * Обробатывает вхоядщее сообщение
     * @param message входящее сообщение
     */
    public process(message: Message) {
        const { state, data } = this.getState(message.chat.id);
        if (state === "no-state") {
            return;
        }
        this.emit("state:" + state, message, data, { chatId: message.chat.id, message: message.text?.trim() ?? "" });
    }

    /**
     * Возвращает состояние чата
     * @param chatId идентификатор чата
     * @returns состояние чата
     */
    public getState(chatId: ChatId): ComposedState {
        return getChatData(chatId, "state") ?? NO_STATE;
    }
}
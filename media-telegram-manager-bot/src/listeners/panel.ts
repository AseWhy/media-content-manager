import { Container } from "typedi";
import { PanelManager } from "@service/panelManager";
import { ChatId } from "node-telegram-bot-api";

/** Менеджер панелей */
const PANEL_MANAGER = Container.get(PanelManager);

/**
 * Обрабатывает соощение вызова панели
 * @param chatId идентификатор чата
 */
export function panel(chatId: ChatId) {
    PANEL_MANAGER.getPanel(chatId).recreate();
}
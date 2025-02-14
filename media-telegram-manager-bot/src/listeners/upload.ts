import { TorrentError, TorrentService } from "@service/torrent/torrentService";
import { TorrentData } from "@service/torrent/torrentData";
import { readFile } from "fs/promises";
import { PanelDownloadData, PanelManager, PanelPostProcessingData } from "@service/panelManager";
import { CONFIG, ConfigCategoryAdditional, ConfigCategoryName, AdditionalDataHint } from "@const";
import { cancelable, listContent, toLength } from "@service";
import { validate } from "jsonschema";
import { ChatStateManager } from "@service/telegram/chatStateManager";
import { Container } from "typedi";
import { MediaProgressData, PostProcessCompleteOrder, PostProcessOrder, ProcessingService } from "@service/processing/processingService";
import { execute } from "@service/execute";

import _ from "lodash";
import TelegramBot, { ChatId, Message, SendMessageOptions } from "node-telegram-bot-api";
import parseTorrent, { toMagnetURI } from "parse-torrent";

/** Торрент сервис */
const TORRENT_SERVICE = Container.get(TorrentService);

/** Менеджер панелей */
const PANEL_MANAGER = Container.get(PanelManager);

/** Менеджер состояния чата */
const STATE_MANAGER = Container.get(ChatStateManager);

/** Сервис пост обработки */
const PROCESSING_SERVICE = Container.get(ProcessingService);

/** Бот */
const BOT = Container.get(TelegramBot);

/** Сообщение при выборе наименования */
const MESSAGE_NAMING = cancelable(`Пришлите наименование для сохранения файла без расширения. Например: Best Movie Ever`);

/** Сообщение при выборе категории загрузки */
const MESSAGE_CATEGORY_LIST = cancelable(listContent(`Выберите тип содержимого`, Object.entries(CONFIG.categories),
    ([ category, data ]) => `<code>${toLength(data.name, 10)}</code> /${category}`));

/** Сообщение "Загрузка отменена" */
const MESSAGE_UPLOAD_CANCEL = "Загрузка отменена!";

/** Сообщение "Торрент уже загружается" */
const MESSAGE_TORRENT_ALREADY_DLOWNLOADING = "Торрент уже загружается и не может быть добавлен!";

/** Сообщение "Загрузка добавлена!" */
const MESSAGE_DOWNLOAD_ADDED = "Загрузка добавлена!";

/** Префикс действий на клавиатуре */
export const KEYBOARD_PREFIX = "upload";

/**
 * Разбирает полученное сообщение и возвращает объект для загрузки
 * @param msg сообщение
 * @returns магнитная ссылка, или torrent файл, или `null` если разобрать сообщение не удалось
 */
async function parse(msg: Message): Promise<string | null> {
    const { document, text } = msg;
    if (document) {
        const file = await BOT.downloadFile(document.file_id, "/tmp");
        const torrentContent = await readFile(file);
        const torrent = await parseTorrent(torrentContent);
        return toMagnetURI({ infoHash: torrent.infoHash });
    }
    if (text) {
        const match = /(magnet:[aA-zZ?=:0-9&.+_\/%]+)/.exec(text);
        if (match) {
            return match[1];
        }
    }
    return null;
}

/**
 * Устанавливает слушатель на сообщения о загрузке
 * @param msg сообщение
 */
export async function upload(msg: Message) {
    const chatId = msg.chat.id;
    const magnet = await parse(msg);

    if (magnet == null) {
        return;
    }

    STATE_MANAGER.state(chatId, "upload_naming", { magnet });

    await BOT.sendMessage(chatId, MESSAGE_NAMING);
}

/**
 * Обрабатывает ввод дополнительных данных по умолчанию
 * @param chatId идентификатор чата
 * @param data   данные
 */
export async function uploadAdditionalData(chatId: ChatId, messageId: number, data: string) {
    // Эмулируем отправку данных пользователем
    STATE_MANAGER.process(chatId, data);
    // Очищаем клавиатуру
    await BOT.editMessageReplyMarkup({ inline_keyboard: [] }, { message_id: messageId, chat_id: chatId });
    // Отправляем введенные данные
    await BOT.sendMessage(chatId, data);
}

/**
 * Генерирует параметры отправки сообщения для запроса дополнительных данных
 * @param name       наименование медиафайла
 * @param category   категория медиафайла
 * @param additional дополнительные данные
 * @returns параметры отправки сообщения
 */
async function createAdditionalMessageParams(name: string, category: ConfigCategoryName, additional: ConfigCategoryAdditional) {
    const params: SendMessageOptions = {};
    if (additional.hint) {
        const hint: AdditionalDataHint = await execute("name", "category", "additionalData", additional.hint)(name, category, additional);
        console.log("Предложены варианты подсказки: ", hint);
        if (hint && hint.length > 0) {
            params.reply_markup = {
                inline_keyboard: hint ?
                hint.map(item => [ { text: item.text, callback_data: `${KEYBOARD_PREFIX}:${item.data}` } ]) :
                    []
            }
        }
    }
    return params;
}

// Обработка получения наименования загрузки
STATE_MANAGER.on("state:upload_naming", async ({ magnet }, { message, chatId }) => {
    if (message === '/cancel') {
        await BOT.sendMessage(chatId, MESSAGE_UPLOAD_CANCEL);
        STATE_MANAGER.flush(chatId);
        return;
    }

    if (_.isEmpty(message)) {
        await BOT.sendMessage(chatId, MESSAGE_NAMING);
    } else {
        // Запрашиваем дополнительные данные
        STATE_MANAGER.state(chatId, "upload_category", { magnet, name: message });
        STATE_MANAGER.process(chatId, message);
    }
});

// Обработку получения категории (фильм, тв шоу, музыка)
STATE_MANAGER.on("state:upload_category", async ({ magnet, name }, { message, chatId }) => {
    if (message === '/cancel') {
        await BOT.sendMessage(chatId, MESSAGE_UPLOAD_CANCEL);
        STATE_MANAGER.flush(chatId);
        return;
    }

    const category = message.substring(1);

    // Проверяем что категория действиетльная
    if (category in CONFIG.categories) {
        STATE_MANAGER.state(chatId, "upload_additional", { magnet, category, name, additionalIdx: 0, additionalData: {} });
        STATE_MANAGER.process(chatId, message);
    } else {
        await BOT.sendMessage(chatId, MESSAGE_CATEGORY_LIST, { parse_mode: "HTML" });
    }
});

// Обработку получения дополнительных данных (Сезон, Альбом)
STATE_MANAGER.on("state:upload_additional", async ({ magnet, category, name, additionalIdx, additionalData }, { message, chatId }) => {
    if (message === '/cancel') {
        await BOT.sendMessage(chatId, MESSAGE_UPLOAD_CANCEL);
        STATE_MANAGER.flush(chatId);
        return;
    }

    const categoryData = CONFIG.categories[category as ConfigCategoryName];
    const additional = categoryData.additional[additionalIdx];

    if (additional) {
        if (validate(message, additional.schema).valid) {
            const nextAdditional = categoryData.additional[additionalIdx + 1];
            STATE_MANAGER.state(chatId, "upload_additional", { magnet, category, name, additionalIdx: additionalIdx + 1,
                additionalData: { ...additionalData, [additional.name]: message.trim() } });
            if (nextAdditional) {
                // Отправляем сообщение
                await BOT.sendMessage(chatId, cancelable(nextAdditional.message),
                    await createAdditionalMessageParams(name, category, nextAdditional));
            } else {
                // В случае, если это последние запрошенные данные то завершаем цикл
                STATE_MANAGER.process(chatId, message);
            }
        } else {
            await BOT.sendMessage(chatId, cancelable(additional.message),
                await createAdditionalMessageParams(name, category, additional));
        }
    } else {
        try {
            const downalodResult = await TORRENT_SERVICE.download({
                category: category as ConfigCategoryName,
                magnet, name, additionalData,
                data: { chatId }
            });
    
            // Начинаем загрузку
            if (downalodResult.result === 'success') {
                await BOT.sendMessage(chatId, MESSAGE_DOWNLOAD_ADDED);
            } else {
                await BOT.sendMessage(chatId, MESSAGE_TORRENT_ALREADY_DLOWNLOADING);
            }
        } catch(e) {
            if (e instanceof TorrentError) {
                await BOT.sendMessage(chatId, e.message);
            } else {
                console.error(e);
            }
        } finally {
            STATE_MANAGER.flush(chatId);
        }
    }
});

// Действие при прогрессе пост обработки
PROCESSING_SERVICE.on("progress", (events: MediaProgressData[]) => {
    const eventGroups = _.groupBy(events, e => e.order.data.chatId);
    for (const key in eventGroups) {
        const panel = PANEL_MANAGER.getPanel(key);
        for (const event of eventGroups[key]) {
            panel.add(event.key, new PanelPostProcessingData(event.order.name, event.info?.progress ?? 0, event.info?.speed ?? 0));
        }
    }
});

// Действие при ошибке пост обработки
PROCESSING_SERVICE.on("error", (id: string, order: PostProcessOrder) => {
    PANEL_MANAGER.getPanel(order.data.chatId).remove(id);
});

// Действие при завершении пост обработки
PROCESSING_SERVICE.on("done", (id: string, order: PostProcessCompleteOrder) => {
    PANEL_MANAGER.getPanel(order.order.data.chatId).remove(id);
});

// Действие при окончании загрузки
TORRENT_SERVICE.on("done", (torrent: TorrentData) => {
    const panel = PANEL_MANAGER.getPanel(torrent.data.chatId);
    for (const { name } of torrent.files) {
        panel.remove(torrent.id + name);
    }
    panel.remove(torrent.id);
});

// Действие при получении новых данных торрента
TORRENT_SERVICE.on("download", (torrent: TorrentData) => {
    const panel = PANEL_MANAGER.getPanel(torrent.data.chatId);
    const files = torrent.files;

    panel.add(torrent.id, new PanelDownloadData(torrent.name, torrent.downloadSpeed, torrent.size, torrent.downloaded, torrent.progress, false));

    // Нет смысл отображать единственный файл в загрузке, который ещё и называется как сам торрент
    if (files.length === 1 && files[0].name === torrent.name) {
        return;
    }
    for (const { name, size, downloaded, progress } of files) {
        panel.add(torrent.id + name, new PanelDownloadData(`- ${name}`, 0, size, downloaded, progress, true));
    }
});

/** Восстанавливаем ранее загруженные данные */
TORRENT_SERVICE.restoreDownloading();
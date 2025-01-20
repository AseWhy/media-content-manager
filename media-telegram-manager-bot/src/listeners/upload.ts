import { TorrentError, TorrentService, TorrentStoredData } from "../service/torrent/torrentService";
import { TorrentData } from "../service/torrent/torrentData";
import { readFile } from "fs/promises";
import { PanelData, PanelManager } from "../service/panelManager";
import { CONFIG, ConfigCategory, ConfigCategoryName } from "../constants";
import { cancelable, listContent, toLength } from "../service";
import { validate } from "jsonschema";
import { ChatStateManager } from "../service/telegram/chatStateManager";
import { Container } from "typedi";

import _ from "lodash";
import TelegramBot, { Message } from "node-telegram-bot-api";
import parseTorrent, { toMagnetURI } from "parse-torrent";

/** Торрент сервис */
const TORRENT_SERVICE = Container.get(TorrentService);

/** Менеджер панелей */
const PANEL_MANAGER = Container.get(PanelManager);

/** Менеджер состояния чата */
const STATE_MANAGER = Container.get(ChatStateManager);

/** Бот */
const BOT = Container.get(TelegramBot);

/** Сообщение при выборе наименования */
const MESSAGE_NAMING = cancelable(`Пришлите наименование для сохранения файла без расширения. Например: Best Movie Ever (2019) [imdbid-tt2575988]`);

/** Сообщение при выборе категории загрузки */
const MESSAGE_CATEGORY_LIST = cancelable(listContent(`Выберите тип содержимого`, Object.entries(CONFIG.categories),
    ([ category, data ]) => `<code>${toLength(data.name, 10)}</code> /${category}`));

/** Сообщение "Загрузка отменена" */
const MESSAGE_UPLOAD_CANCEL = "Загрузка отменена!";

/** Сообщение "Торрент уже загружается" */
const MESSAGE_TORRENT_ALREADY_DLOWNLOADING = "Торрент уже загружается и не может быть добавлен!";

/** Сообщение "Загрузка добавлена!" */
const MESSAGE_DOWNLOAD_ADDED = "Загрузка добавлена!";

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
 * Функция преобразования введенных данных пользователя в дополнительные данные
 * @param categoryData данные категории
 * @param input        введенные данные пользователя
 * @returns дополнительные данные
 */
function computeDir(categoryData: ConfigCategory, input: string) {
    const additional = categoryData.additional;
    if (additional == null) {
        return null;
    }
    const processor = new Function("input", additional.processor);
    return processor(input);
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

// Обработка получения наименования загрузки
STATE_MANAGER.on("state:upload_naming", async (msg: Message, { magnet }, { message, chatId }) => {
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
        STATE_MANAGER.process(msg);
    }
});

// Обработку получения категории (фильм, тв шоу, музыка)
STATE_MANAGER.on("state:upload_category", async (msg: Message, { magnet, name }, { message, chatId }) => {
    if (message === '/cancel') {
        await BOT.sendMessage(chatId, MESSAGE_UPLOAD_CANCEL);
        STATE_MANAGER.flush(chatId);
        return;
    }

    const category = message.substring(1);

    // Проверяем что категория действиетльная
    if (category in CONFIG.categories) {
        const categoryData = CONFIG.categories[category as ConfigCategoryName];

        STATE_MANAGER.state(chatId, "upload_additional", { magnet, category, name });

        if (categoryData.additional) {
            await BOT.sendMessage(chatId, cancelable(categoryData.additional.message));
        } else {
            STATE_MANAGER.process(msg);
        }
    } else {
        await BOT.sendMessage(chatId, MESSAGE_CATEGORY_LIST, { parse_mode: "HTML" });
    }
});

// Обработку получения дополнительных данных (Сезон, Альбом)
STATE_MANAGER.on("state:upload_additional", async (msg: Message, { magnet, category, name }, { message, chatId }) => {
    if (message === '/cancel') {
        await BOT.sendMessage(chatId, MESSAGE_UPLOAD_CANCEL);
        STATE_MANAGER.flush(chatId);
        return;
    }

    const categoryData = CONFIG.categories[category as ConfigCategoryName];

    if (categoryData.additional && !validate(message, categoryData.additional.schema)) {
        await BOT.sendMessage(chatId, cancelable(categoryData.additional.message));
    } else {
        try {
            const downalodResult = await TORRENT_SERVICE.download({
                category: category as ConfigCategoryName,
                magnet, name, dir: computeDir(categoryData, message),
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
            }
            console.error(e);
        }

        STATE_MANAGER.flush(chatId);
    }
});

// Действие при окончании загрузки
TORRENT_SERVICE.on("done", (torrent: TorrentData, data: TorrentStoredData) => {
    const panel = PANEL_MANAGER.getPanel(torrent.data.chatId);
    for (const { name } of torrent.getFiles(CONFIG.categories[data.category])) {
        panel.remove(torrent.id + name);
    }
    panel.remove(torrent.id);
});

// Действие при получении новых данных торрента
TORRENT_SERVICE.on("download", (torrent: TorrentData, data: TorrentStoredData) => {
    const panel = PANEL_MANAGER.getPanel(torrent.data.chatId);
    const files = torrent.getFiles(CONFIG.categories[data.category]);

    panel.add(torrent.id, new PanelData(torrent.name, torrent.downloadSpeed, torrent.size, torrent.downloaded, torrent.progress, false));

    // Нет смысл отображать единственный файл в загрузке, который ещё и называется как сам торрент
    if (files.length === 1 && files[0].name === torrent.name) {
        return;
    }
    for (const { name, size, downloaded, progress } of files) {
        panel.add(torrent.id + name, new PanelData(`- ${name}`, 0, size, downloaded, progress, true));
    }
});

/** Восстанавливаем ранее загруженные данные */
TORRENT_SERVICE.restoreDownloading();
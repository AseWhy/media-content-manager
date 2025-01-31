import { readFileSync } from "fs";
import { Schema } from "jsonschema";
import { tmpdir } from "os";

/** Директория для размещения медиаконтента */
export const MANAGED_DIR = process.env.MANAGED_DIR ?? "./media";

/** Директория для загрузки торрентов */
export const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? "./downloads";

/** Директория, в которую будет выполняться загрузка файлов полученных из пост обработчика */
export const PROCESSOR_DIR = process.env.PROCESSOR_DIR ?? tmpdir();

/** Интервал запроса данных с пост обработчиков */
export const PULL_INTERVAL = process.env.PULL_INTERVAL ? parseInt(process.env.PULL_INTERVAL) : 5000;

/** Токен бота */
export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";

/** Ограничение скорости загрузки */
export const DOWNLOAD_LIMIT = process.env.DOWNLOAD_LIMIT ? parseInt(process.env.DOWNLOAD_LIMIT) : -1;

/** Идентификаторы пользователей, имеющийх возможность скачивать торренты */
export const BOT_ALLOWED_USER_IDS = process.env.BOT_ALLOWED_USER_IDS?.split(",").map(e => e.trim()).map(parseInt) ?? [974344494];

/** Конфигурация */
export const CONFIG: Config = JSON.parse(readFileSync(process.env.CONFIG_LOCATION || "config/config.json").toString("utf8"));

/** Название категории */
export type ConfigCategoryName = "music" | "tv" | "movies";

/**
 * Конфигурация доп. данных
 */
export type ConfigCategoryAdditional = {
    /** Наименование поля */
    name: string;
    /** Сообщение пользователю */
    message: string;
    /** Функция обработки введеных данных */
    processor: string;
    /** Схема */
    schema: Schema;
}

/**
 * Категория конфигурации
 */
export type ConfigCategory = {
    /** Список расширений */
    ext:  string[];
    /** Наименование категории расширений */
    name: string;
    /** Функция обработки пути сохранения файла */
    pathFunction: string;
    /** Тип дополнительно запрашиваемых данных */
    additional: ConfigCategoryAdditional[];
}

/**
 * Конфигурация постобработки
 */
export type ConfigPostprocessing = {
    /** Признак необходимости выполнять пост обработку */
    enabled: boolean;
    /** Гейтвеи для подключения к пост обработчикам */
    gateways: string[];
    /** Категории постобработки */
    config: Record<ConfigCategoryName, any>
}

/**
 * Конфигурация приложения
 */
export type Config = {
    /** Идентификатор текущего узла */
    nodeId: string;
    /**
     * Стратегия сохранения файлов
     * Либо сохранять файл сразу после загрузки
     * Либо сохранять файл только после полной загрузки всех файлов торрента
     */
    fileSaveStrategy: "byFile" | "byTorrent";
    /** Конфигурация постобработки */
    postProcessing: ConfigPostprocessing;
    /** Конфигурация расширений */
    categories: Record<ConfigCategoryName, ConfigCategory>
}
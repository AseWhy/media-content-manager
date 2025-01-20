import { readFileSync } from "fs";
import { Schema } from "jsonschema";

/** Папка для загрузки торрентов */
export const MANAGED_DIR = process.env.MANAGED_DIR ?? "./downloads";

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
 * Категория конфигурации
 */
export type ConfigCategory = {
    /** Список расширений */
    ext:  string[];
    /** Наименование категории расширений */
    name: string;
    /** Тип дополнительно запрашиваемых данных */
    additional?: {
        /** Сообщение пользователю */
        message: string;
        /** Функция обработки введеных данных */
        processor: string;
        /** Схема */
        schema: Schema;
    };
}

/**
 * Конфигурация постобработки
 */
export type ConfigPostprocessing = {
    /** Признак необходимости выполнять пост обработку */
    enabled: boolean;
    /** Гейтвеи для подключения к постобработчикам */
    gateways: string[];
    /** Категории постобработки */
    categories: Record<ConfigCategoryName, any>
}

/**
 * Конфигурация приложения
 */
export type Config = {
    /** Идентификатор текущего узла */
    nodeId: string;
    /** Конфигурация постобработки */
    postProcessing: ConfigPostprocessing;
    /** Конфигурация расширений */
    categories: Record<ConfigCategoryName, ConfigCategory>
}
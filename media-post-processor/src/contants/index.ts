import { readFileSync } from "fs";
import { resolve } from "path";

/** Конфигурация */
export const CONFIG: Config = JSON.parse(readFileSync(process.env.CONFIG_LOCATION || "config/config.json").toString("utf8"));

/** Директория в которой хранятся обработанные файлы */
export const PROCESSING_DIR = process.env.PROCESSING_DIR ?? resolve("./processing");

/** Разрешения выхода */
export type ProcessingResolutions = "720p" | "1080p" | "2160p";

/** Тип обработки */
export type ProcessingType = "movies" | "tv";

/**
 * Конфигурация приложения
 */
export type Config = {
    /** Конфигурация постобработки */
    processing: ProcessingConfig;
}

/**
 * Конфигурация постобработки
 */
export type ProcessingConfig = {
    /** Конфигурация постобработки фильмов */
    movies: VideoProcessingConfigRule<ProcessingResolutions>;
    /** Конфигурация постобработки тв шоу */
    tv: VideoProcessingConfigRule<"720p" | "1080p">;
}

/**
 * Правило постобработки
 */
export type VideoProcessingConfigRule<Name> = {
    /** Конфигурация постобработки */
    outputs: VideoProcessingOutputConfig<Name>[];
    /** Функция получения названия выходящего файла */
    filenameFunction: string;
    /** Дополнительные параметры запуска постобработки */
    additinalParams: string[];
}

/**
 * Конфигурация выхода постобработчика
 */
export type VideoProcessingOutputConfig<Name> = {
    /** Наименование вывода */
    name: Name;
    /** Разрешения выхода */
    resolution: [ number, number ];
    /** Кодек постобработки */
    codec: string;
    /** Пресет постобработки */
    preset: string;
}
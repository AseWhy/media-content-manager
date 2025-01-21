import { readFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";

/** Конфигурация */
export const CONFIG: Config = JSON.parse(readFileSync(process.env.CONFIG_LOCATION || "config/config.json").toString("utf8"));

/** Директория в которой хранятся обработанные файлы */
export const PROCESSING_DIR = process.env.PROCESSING_DIR ?? resolve("./processing");

/** Директория в которой хранятся файлы ожидающие обработки */
export const PENDING_DIR = process.env.PENDING_DIR ?? tmpdir();

/** Порт для прослушивания пост обработчика */
export const APP_PORT = process.env.APP_PORT ?? 1949;

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
    /** Приоритет процессов постобработки от -20 до 20 */
    priority: number;
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
 * Конфигурация выхода пост обработчика
 */
export type VideoProcessingOutputConfig<Name> = {
    /** Наименование вывода */
    name: Name;
    /** Разрешения выхода */
    resolutions: [ number, number ][];
    /** Кодек постобработки */
    codec: string;
    /** Пресет постобработки */
    preset: string;
}
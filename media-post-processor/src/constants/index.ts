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

/** Тип обработки */
export type ProcessingType = "movies" | "tv";

/** Тип кодека видеофайла */
export type VideoCodecType = "audio" | "subtitle";

/**
 * Конфигурация приложения
 */
export type Config = {
    /** Конфигурация постобработки */
    processing: ProcessingConfig;
    /** Конфигурация постобработки */
    outputs: Record<string, VideoProcessingOutputConfig>;
    /** Приоритет процессов постобработки от -20 до 20 */
    priority: number;
    /** Максимальное количество одновременно выполняемых задач пост обработки */
    maxTasks: number;
}

/**
 * Конфигурация постобработки
 */
export type ProcessingConfig = {
    /** Конфигурация постобработки фильмов */
    movies: VideoProcessingConfigRule;
    /** Конфигурация постобработки тв шоу */
    tv: VideoProcessingConfigRule;
}

/**
 * Дополнительные параметры постобработки
 */
export type VideoProcessingConfigAdditionalParamsConfig = {
    /** Общие параметры пост обработки */
    common: string[];
    /** Параметры пост обработки выходов */
    output: string[];
    /** Параметры пост обработки входов */
    input: string[];
};

/**
 * Правило постобработки
 */
export type VideoProcessingConfigRule = {
    /** Функция получения названия выходящего файла */
    filenameFunction: string;
    /** Видео кодек */
    videoCodec: string;
    /** Аудио кодек */
    audioCodec: string;
    /** Дополнительные параметры запуска постобработки */
    additinalParams: VideoProcessingConfigAdditionalParamsConfig;
}

/**
 * Конфигурация выхода пост обработчика
 */
export type VideoProcessingOutputConfig = {
    /** Наименование вывода */
    name: string;
    /** Наименование выхода, данные которого должны наследоваться */
    extend?: string;
    /** Функция получения состояния выхода */
    enabled?: string;
    /** Дополнительные параметры выхода */
    additinalParams: string[];
    /** Данные выхода */
    data: Record<string, string>;
}
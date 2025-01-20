import { FSDB } from "file-system-db";
import { CONFIG, PROCESSING_DIR, ProcessingResolutions, ProcessingType } from "../contants";
import { hash } from "crypto";
import { join, parse } from "path";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { Service } from "typedi";

import EventEmitter from "events";
import ffmpeg, { FfprobeStream } from "fluent-ffmpeg";
import _ from "lodash";

/** Ключ обрабатываемых данных */
const PROCESSING_KEY = "processing";

/** Ключ обработанных данных */
const COMPLETED_KEY = "completed";

/** База данных обработчика */
const DATABASE = new FSDB("./data/processing.json", false);

/**
 * Постобработчик медиафайлов
 */
@Service({ factory, eager: true })
export class MediaPostProcessor extends EventEmitter {

    /** Карта, где ключ это путь до медиафайла а значение это запись обработки */
    private readonly _currentProcessing: Record<string, CustomerOrder> = {};

    /** Максимальное количество постобработок в одно время */
    private readonly _maxTasks = 2;

    /** Карта, где ключ это тип содержимого а значение это функция обработки */
    private readonly _processors: Record<string, (id: string, order: CustomerOrder) => Promise<void>> = {
        "movies": this._processVideo.bind(this),
        "tv":     this._processVideo.bind(this)
    };

    /**
     * Конструктор
     */
    constructor() {
        super();
    }

    /**
     * Начинает обработку медиа содержимого
     * @param customer    заказчик обработки
     * @param type        тип медиа
     * @param pathToMedia путь до медиафайла
     * @param config      конфигурация
     */
    public process(order: CustomerOrder): ProcessResult {
        const id = hash("sha256", order.pathToMedia);
        if (this._isProcessing(id)) {
            return { result: "already_processing", id };
        }
        if (order.type in this._processors) {
            this._addToProcess(id, order);
            this._processNext();
        } else {
            return { result: "bad_mediatype", id }
        }
        return { result: "success", id };
    }

    /**
     * Восстанавливает обработку медиафайлов
     */
    public restoreProcessing() {
        const processing = Object.entries(this._currentProcessing);
        const rest = this._maxTasks - processing.length;
        for (let i = 0; i < rest; i++) {
            this._processNext();
        }
    }

    /**
     * Возвращает получает и удаляет из обработанных первый завершенный заказ
     * @param oneElement обработчик получения одного элемента
     * @param noElements обработчик отсутствия элементов для получения
     * @returns завершенный заказ
     */
    public async pullCompleted(oneElement: (completed: CustomerOrderProcessing) => Promise<void>, noElements: () => void): Promise<void> {
        const completed = DATABASE.get(COMPLETED_KEY) ?? {};
        const first = Object.keys(completed)[0];
        if (first == null) {
            noElements();
        } else {
            const firstProcessing = completed[first];
            try {
                await oneElement(firstProcessing);
                delete completed[first];
                DATABASE.set(COMPLETED_KEY, completed);
            } catch(e) {
                console.error(e);
            }
        }
    }

    /**
     * Восстанавливает обработки с предыдущего запуска
     */
    private async _processNext() {
        const bag: Promise<void>[] = [];
        for (const [ id, order ] of Object.entries(this._allProcessing())) {
            if (id in this._currentProcessing) {
                continue;
            }
            if (bag.push(this._process(id, order)) >= this._maxTasks) {
                break;
            }
        }
        if (bag.length === 0) {
            return;
        }
        await Promise.all(bag);
        this._processNext();
    }

    /**
     * Начинает обработку медиа содержимого видеофайла
     * @param id    идентификатор медиафайла
     * @param order заказ на постобработку
     */
    private async _process(id: string, order: CustomerOrder): Promise<void> {
        this._currentProcessing[id] = order;

        await this._processors[order.type](id, order);

        delete this._currentProcessing[id];
    }

    /**
     * Начинает обработку медиа содержимого видеофайла
     * @param id    идентификатор медиафайла
     * @param order заказ на постобработку
     */
    private _processVideo(id: string, order: CustomerOrder): Promise<void> {
        const { resolutions } = order.config;
        const { name } = parse(order.name);

        return new Promise((res, rej) => {
            ffmpeg(order.pathToMedia).ffprobe(async (err, data) => {
                if (err) {
                    return rej(err);
                }

                try {
                    const { width, height } = this._findVideoStream(data.streams);
                    const { filenameFunction: filenameFunctionStr, outputs, additinalParams } = CONFIG.processing.movies;

                    // Исключенные потоки
                    const filenameFunction = new Function("filename", "name", "ext", filenameFunctionStr);
                    const excludedStreams = this._filterExcludedStreams(data.streams, order.config);
                    const ratio = width / height;
                    const directory = join(PROCESSING_DIR, id);
                    const result: string[] = [];

                    if (!existsSync(directory)) {
                        await mkdir(directory, { recursive: true });
                    }

                    let ffmpegBuilder = ffmpeg()
                        .input(order.pathToMedia);

                    for (const config of outputs) {
                        // Если высота выхода конфигурации больше возможной
                        if (!resolutions.includes(config.name) || config.resolution[1] > height) {
                            continue;
                        }

                        const sampleWidth = config.resolution[1] * ratio;
                        const sampleHeight = config.resolution[1];
                        const filePath = join(directory, filenameFunction(name, config.name, ".mkv"));

                        ffmpegBuilder = ffmpegBuilder
                            .addOutput(filePath)
                            .addOutputOption("-s", `${sampleWidth}x${sampleHeight}`)
                            .addOutputOption("-preset", config.preset)
                            .audioCodec("copy")
                            // Берем все потоки из входа 0
                            .addOutputOption("-map", "0");
                        if (additinalParams) {
                            ffmpegBuilder = ffmpegBuilder.addOutputOptions(additinalParams);
                        }
                        if (width === sampleWidth && height === sampleHeight) {
                            ffmpegBuilder = ffmpegBuilder.videoCodec("copy");
                        } else {
                            ffmpegBuilder = ffmpegBuilder.videoCodec(config.codec);
                        }
                        for (const stream of excludedStreams) {
                            // Исключаем некоторые потоки из входа 0
                            ffmpegBuilder = ffmpegBuilder.addOutputOption("-map", `-0:${stream.index}`);
                        }
                        result.push(filePath);
                    }

                    const orderProcessing = { ...order, directory, result, id };

                    // Вешаем слушатели на процесс ffmpeg
                    ffmpegBuilder.once("error", rej);
                    ffmpegBuilder.once("end", this._onDone.bind(this, orderProcessing));
                    ffmpegBuilder.once("end", res);
                    ffmpegBuilder.once('exit', () => console.log('Video recorder exited'));
                    
                    // При выходе из программы убиваем процесс ffmpeg
                    const kill = () => ffmpegBuilder.kill("SIGKILL");

                    process.once("exit", kill);
                    process.once("SIGINT", kill);
                    process.once("SIGUSR1", kill);
                    process.once("SIGUSR2", kill);
                    process.once("uncaughtException", kill);

                    // Выводим команду запуска
                    console.log("Добавлена постобработка", ffmpegBuilder._getArguments());

                    // Запускаем обработку
                    ffmpegBuilder.run();
                } catch(e) {
                    return rej(e);
                }
            });
        });
    }

    /**
     * Действие при прогрессе выполнения обработки медиафайла
     * @param processing обрабатываемый медиафайл
     */
    private async _onDone(processing: CustomerOrderProcessing) {
        // Помечаем как исполненный
        this._addToCompleted(processing.id, processing);
        this._delFromProcess(processing.id);
        // Удаляем медиафайл
        await rm(processing.pathToMedia);
    }

    /**
     * Возвращает первый найденный видеопоток
     * @param streams потоки
     * @returns первый найденный видеопоток
     */
    private _findVideoStream(streams: FfprobeStream[]): any {
        // Видеопоток
        const videoStream = streams.find(e => e.codec_type === 'video');
        if (videoStream == null) {
            throw new Error("Видео поток не найден");
        }
        return videoStream;
    }

    /**
     * Возвращает исключенные из медиафайла потоки
     * @param streams потоки
     * @param config  конфигурация
     * @returns исключенные из медиафайла потоки
     */
    private _filterExcludedStreams(streams: FfprobeStream[], config: MovieMediaConfiguration) {
        return streams.filter(e => {
            if (e.codec_type === "audio") {
                return !Object.values<string>(e.tags).some(audioTag => config.allowedaudio.contains.some(allowed => audioTag.includes(allowed)));
            } else if (e.codec_type === "subtitle") {
                return !Object.values<string>(e.tags).some(subTag => config.allowedsubs.contains.some(allowed => subTag.includes(allowed)));
            }
            return false;
        });
    }

    /**
     * Возвращает признак того, что медиафайл уже обрабатывается
     * @param id идентификатор медиафайла
     * @returns `true`, если файл уже обрабатывается
     */
    private _isProcessing(id: string): boolean {
        return DATABASE.has(`${PROCESSING_KEY}.${id}`);
    }

    /**
     * Добавляет данные к таблице обрабатываемых медиа файлов
     * @param id    идентификатор медиафайла
     * @param order заказ на обработку
     */
    private _addToProcess(id: string, order: CustomerOrder) {
        DATABASE.set(`${PROCESSING_KEY}.${id}`, order);
    }

    /**
     * Удаляет данные из таблицы обрабатываемых медиа файлов
     * @param id идентификатор медиафайла
     */
    private _delFromProcess(id: string) {
        DATABASE.delete(`${PROCESSING_KEY}.${id}`);
    }

    /**
     * Возвращает все обрабатываемые на данные момент заказы
     * @returns все обрабатываемые на данные момент заказы
     */
    private _allProcessing(): Record<string, CustomerOrder> {
        return DATABASE.get(PROCESSING_KEY) ?? {}
    }

    /**
     * Добавляет данные к таблице обрабатываемых медиа файлов
     * @param id    идентификатор медиафайла
     * @param order заказ на обработку
     */
    private _addToCompleted(id: string, order: CustomerOrder) {
        DATABASE.set(`${COMPLETED_KEY}.${id}`, order);
    }
}

/**
 * Создает экземпляр постобработчика медиаконтента
 * @returns экземпляр постобработчика медиаконтента
 */
function factory() {
    const processor = new MediaPostProcessor();
    processor.restoreProcessing();
    return processor;
}

/**
 * Результат постобработки
 */
export type ProcessResult = {
    /** Результат добавления медиа на постобработку */
    result: "success" | "already_processing" | "bad_mediatype";
    /** Идентификатор обрабатываемого медиафайла */
    id: string;
}

/**
 * Структура заказа постобработки
 */
export type CustomerOrder = {
    /** Тип постобработки */
    type: ProcessingType;
    /** Заказчик обработки медиафайла */
    customer: string;
    /** Путь до медиафайла */
    pathToMedia: string;
    /** Наименование медиа */
    name: string;
    /** Конфигурация постобработки */
    config: any;
}

/**
 * Данные обрабатываемого заказа
 */
export type CustomerOrderProcessing = CustomerOrder & {
    /** Директория в которой находятся файлы */
    directory: string;
    /** Список путей до обработанных медиафайлов */
    result: string[];
    /** Идентификатор обработки */
    id: string;
}

/**
 * Интерфейс поиска совпадающих значений
 */
export type MovieMediaMatchConfig = {
    contains: string[];
};

/**
 * Конфигурация постобработки фильмов
 */
export type MovieMediaConfiguration = {
    /** Допустимые разрешения */
    resolutions: ProcessingResolutions;
    /** Допустимые субтитры */
    allowedsubs: MovieMediaMatchConfig;
    /** Допустимые аудиодорожки */
    allowedaudio: MovieMediaMatchConfig;
};
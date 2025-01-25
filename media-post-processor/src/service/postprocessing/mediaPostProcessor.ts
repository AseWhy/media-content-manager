import { FSDB } from "file-system-db";
import { hash } from "crypto";
import { Service } from "typedi";
import { CustomerOrder, CustomerOrderProcessing, MediaProcessor } from "./processors/mediaProcessor";
import { ProgressData, VideoMediaProcessor } from "./processors/videoMediaProcessor";
import { rm } from "fs/promises";
import { CONFIG } from "../../contants";
import { SpeedIndicator } from "../speedIndicator";

import EventEmitter from "events";
import _ from "lodash";

/** Ключ обрабатываемых данных */
const PROCESSING_KEY = "processing";

/** Ключ обработанных данных */
const COMPLETED_KEY = "completed";

/** База данных обработчика */
const DATABASE = new FSDB("./data/processing.json", false);

/**
 * пост обработчик медиафайлов
 */
@Service({ factory, eager: true })
export class MediaPostProcessor extends EventEmitter {

    /** Карта, где ключ это путь до медиафайла а значение это запись обработки */
    private readonly _currentProcessing: Record<string, CustomerOrder> = {};

    /** Карта, где ключ это тип содержимого а значение это функция обработки */
    private readonly _processors: Record<string, MediaProcessor>;

    /** Набор аткивных заказчиков постобработки, у которых в данный момент выполнятся запрос данных */
    private readonly _activeRequests: Set<string> = new Set();

    /** Информация о ходе обработки медиафайлов */
    private readonly _info: Record<string, Record<string, MediaProcessingInfo>> = {};

    /** Индикатор скорости обработки */
    private readonly _speed: Record<string, SpeedIndicator> = {};

    /**
     * Конструктор
     */
    constructor() {
        super();

        const videoProcessor = new VideoMediaProcessor();

        this._processors = { "movies": videoProcessor, "tv": videoProcessor };

        videoProcessor.on("done", this._onDone.bind(this));
        videoProcessor.on("progress", this._onProgress.bind(this));
        videoProcessor.on("error", this._onError.bind(this));
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
    public init(): void {
        const completed = this._getCompleted();
        for (const key in completed) {
            // Помечаем завершенные обработки как завершенные
            this._markProcessingAsDone(completed[key].customer, key);
        }
        this._processNext();
    }

    /**
     * Возвращает данные прогресса пост обработки
     * @param заказчик постобработки
     */
    public async pullInfo(customer: string, process: (completed: Record<string, MediaProcessingInfo> | null) => Promise<void>): Promise<void> {
        const data = this._info[customer] ?? {};
        try {
            await process(data);
            if (_.isEmpty(data)) {
                return;
            }
            for (const key in data) {
                // Удаляем все ключи с ошибками при успешной обработке
                if (data[key].status === 'error') {
                    delete data[key];
                }
            }
        } catch(e) {
            console.error("Ошибка при получении информации о текущих обработках", e);
        }
    }

    /**
     * Возвращает получает и удаляет из обработанных первый завершенный заказ
     * @param customer заказчик постобработки
     * @param process  обработчик получения обработанных файлов
     * @returns завершенный заказ
     */
    public async pullCompleted(customer: string, process: (completed: CustomerOrderProcessing | null) => Promise<void>): Promise<void> {
        // Ищем первый заказ
        const first = Object.entries(this._getCompleted()).find(item => item[1].customer === customer);

        if (first == null || this._activeRequests.has(customer)) {
            process(null);
        } else {
            const [ key, completed ] = first;
            try {
                this._activeRequests.add(customer);
                await process(completed);
                if (this._info[customer]) {
                    delete this._info[customer][key];
                }
                DATABASE.delete(`${COMPLETED_KEY}.${key}`);
            } catch(e) {
                console.error("Ошибка при получении последнего обработанного элемента", e);
            } finally {
                this._activeRequests.delete(customer);
            }
        }
    }

    /**
     * Действие при ошибке
     * @param processing обрабатываемый медиафайл
     */
    private async _onError(processing: CustomerOrderProcessing) {
        if (this._info[processing.customer] == null) {
            this._info[processing.customer] = {};
        }
        // Редактируем статус обработки
        this._info[processing.customer][processing.id] = { status: "error", progress: 100, speed: 0 };
        // Удаляем из обрабатываемых
        this._delFromProcess(processing.id);
        // Удаляем индикатор скорости
        delete this._speed[processing.id];
        // Удаляем медиафайл
        await rm(processing.pathToMedia);
    }

    /**
     * Действие при завершении выполнения обработки медиафайла
     * @param processing обрабатываемый медиафайл
     */
    private async _onDone(processing: CustomerOrderProcessing) {
        // Помечаем как исполненный
        this._addToCompleted(processing.id, processing);
        this._delFromProcess(processing.id);
        // Помечаем как обработанное
        this._markProcessingAsDone(processing.customer, processing.id);
        // Удаляем индикатор скорости
        delete this._speed[processing.id];
        // Удаляем медиафайл
        await rm(processing.pathToMedia);
    }

    /**
     * Действие при завершении выполнения обработки медиафайла
     * @param id       идентификатор медиафайла
     * @param order    заказ на обработку
     * @param progress данные прогресса
     */
    private _onProgress(id: string, order: CustomerOrder, progress: ProgressData) {
        const progressInt = progress.percent ?? 0;
        if (this._info[order.customer] == null) {
            this._info[order.customer] = {};
        }
        if (this._speed[id] == null) {
            this._speed[id] = new SpeedIndicator(progressInt * 100);
        } else {
            this._speed[id].update(progressInt);
        }
        this._info[order.customer][id] = { status: "processing", progress: _.round(progressInt, 2), speed: this._speed[id].speed };
    }

    /**
     * Помечает обработку как завершенную
     * @param customer заказчик обработки
     * @param id       идентификатор обработки
     */
    private _markProcessingAsDone(customer: string, id: string) {
        if (this._info[customer] == null) {
            this._info[customer] = {};
        }
        // Устанавливаем прогресс загрузки на 100%
        this._info[customer][id] = { status: "completed", progress: 100, speed: 0 };
    }

    /**
     * Восстанавливает обработки с предыдущего запуска
     */
    private async _processNext() {
        const existsKeys = _.keys(this._currentProcessing).length;
        const bag: Promise<void>[] = [];
        for (const [ id, order ] of Object.entries(this._allProcessing())) {
            if (id in this._currentProcessing) {
                continue;
            }
            if (bag.length + existsKeys >= CONFIG.maxTasks) {
                break;
            }
            bag.push(this._process(id, order));
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
        try {
            this._currentProcessing[id] = order;

            await this._processors[order.type].process(id, order);

            delete this._currentProcessing[id];
        } catch(e) {
            console.error("Ошибка при обработке медиа", e);
        }
    }

    /**
     * Возвращает карту, где ключ это идентификатор обработки и значение это сама обработка
     * @returns карта, где ключ это идентификатор обработки и значение это сама обработка
     */
    private _getCompleted(): Record<string, CustomerOrderProcessing> {
        return DATABASE.get(COMPLETED_KEY) ?? {};
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
 * Создает экземпляр пост обработчика медиаконтента
 * @returns экземпляр пост обработчика медиаконтента
 */
function factory() {
    const processor = new MediaPostProcessor();
    processor.init();
    return processor;
}

/**
 * Информация о ходе обработки медиафайла
 */
export type MediaProcessingInfo = {
    /** Статус обработки */
    status: "processing" | "completed" | "error";
    /** Скорость обработки % в секунду */
    speed: number;
    /** Прогресс обработки */
    progress: number;
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

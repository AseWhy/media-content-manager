import { FSDB } from "file-system-db";
import { hash } from "crypto";
import { Service } from "typedi";
import { CustomerOrder, CustomerOrderProcessing, MediaProcessor } from "./processors/mediaProcessor";
import { VideoMediaProcessor } from "./processors/videoMediaProcessor";
import { rm } from "fs/promises";

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

    /** Максимальное количество постобработок в одно время */
    private readonly _maxTasks = 2;

    /** Карта, где ключ это тип содержимого а значение это функция обработки */
    private readonly _processors: Record<string, MediaProcessor>;

    /** Набор аткивных заказчиков постобработки, у которых в данный момент выполнятся запрос данных */
    private readonly _activeRequests: Set<string> = new Set();

    /**
     * Конструктор
     */
    constructor() {
        super();
        const videoProcessor = new VideoMediaProcessor();
        this._processors = { "movies": videoProcessor, "tv": videoProcessor };
        videoProcessor.on("done", this._onDone.bind(this));
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
    public init() {
        this._processNext();
    }

    /**
     * Возвращает получает и удаляет из обработанных первый завершенный заказ
     * @param customer   заказчик постобработки
     * @param oneElement обработчик получения одного элемента
     * @param noElements обработчик отсутствия элементов для получения
     * @returns завершенный заказ
     */
    public async pullCompleted(customer: string, oneElement: (completed: CustomerOrderProcessing) => Promise<void>, noElements: () => void): Promise<void> {
        // Ищем первый заказ
        const completed: Record<string, CustomerOrderProcessing> = DATABASE.get(COMPLETED_KEY) ?? {};
        const first = Object.entries(completed).filter(item => item[1].customer === customer).map(item => item[0])[0];

        if (first == null || this._activeRequests.has(customer)) {
            noElements();
        } else {
            try {
                this._activeRequests.add(customer);
                await oneElement(completed[first]);
                delete completed[first];
                DATABASE.set(COMPLETED_KEY, completed);
            } catch(e) {
                console.error(e);
            } finally {
                this._activeRequests.delete(customer);
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
     * Действие при завершении выполнения обработки медиафайла
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
            console.error(e);
        }
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
 * Результат постобработки
 */
export type ProcessResult = {
    /** Результат добавления медиа на постобработку */
    result: "success" | "already_processing" | "bad_mediatype";
    /** Идентификатор обрабатываемого медиафайла */
    id: string;
}

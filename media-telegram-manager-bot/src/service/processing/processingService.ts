import { CONFIG, ConfigCategoryName, PROCESSOR_DIR, PULL_INTERVAL } from "../../constants";
import { Service } from "typedi";
import { FSDB } from "file-system-db";
import { v7 } from "uuid";
import { basename, dirname, join } from "path";
import { createReadStream } from "fs";
import { createWriteStream, existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { json } from "stream/consumers";
import { form, fetch, fetchOnSuccessGatewayResponse } from "../http";
import { getSystemErrorName } from "util";
import { resolveDataDir } from "@service";
import { IncomingMessage } from "http";

import busboy from "busboy";
import EventEmitter from "events";
import FormData from "form-data";
import _ from "lodash";

/** База данных обработчика */
const DATABASE = new FSDB(resolveDataDir("post-processing.json"), false);

/** Ключ обрабатываемых файлов */
const PROCESSING_KEY = "processing";

/** Ключ полученных файлов */
const CONSUMED_KEY = "consumed";

/**
 * Сервис постобработки
 */
@Service()
export class ProcessingService extends EventEmitter {

    /** Массив действующих на момент инициализации гейтвеев */
    private readonly _gateways: string[] = [];

    /**
     * Инициализирует сервис постобработки
     */
    public async init(): Promise<void> {
        if (!CONFIG.postProcessing.enabled) {
            return;
        }
        await this._registration();
        await this._onConsume();
        // Выполняем запрос новых данных
        setTimeout(this._pullProgress.bind(this), PULL_INTERVAL);
    }

    /**
     * Добавляет заказ на постобработку
     * @param path        путь до медиафайла для постобработки
     * @param destination путь до файла файла, под которым он будет сохранен после обработки
     * @param category    категория медиаконтента
     * @param data        дополнительные данные
     */
    async process(path: string, destination: string, category: ConfigCategoryName,  data: Record<string, string>): Promise<void> {
        const filename = basename(destination);

        console.log(`Отправка медиафайла "${path}" [${filename}] на постобработку`);

        for (const gateway of CONFIG.postProcessing.gateways) {
            try {
                const formData = new FormData();

                formData.append("file", createReadStream(path), encodeURIComponent(filename));

                const response = await form(`${gateway}/add-media/${CONFIG.nodeId}/${category}`, formData)

                if (response.statusCode !== 200) {
                    throw new Error("Неожиданный ответ сервера постобработки '" + response.statusCode + "'");
                }

                console.log(`Медиафайл "${path}" успешно отправлен на постобработку`);
                
                const { result: { result, id } }: any = await json(response);
                
                console.log(`Медиафайл "${path}" успешно отправлен на узел ${gateway}. Идентификатор обработки ${id}`);

                if (result !== 'success') {
                    continue
                }

                DATABASE.set(`${PROCESSING_KEY}.${id}`, { dest: dirname(destination), name: filename, data });

                return;
            } catch(e) {
                // Выводим ошибку в любом случае
                console.error(`Ошибка при отправке запроса на узел '${gateway}'`, e);
                // В случае ошибок сокета
                if (getSystemErrorName(e.errno)) {
                    continue;
                } else {
                    throw e;
                }
            }
        }
    }

    /**
     * Выполняет регистрацию на узлах пост-обработчика
     */
    private async _registration(): Promise<void> {
        for (const gateway of CONFIG.postProcessing.gateways) {
            try {
                const response = await fetch(`${gateway}/register/${CONFIG.nodeId}`, {
                    method: "POST",
                    body: { config: CONFIG.postProcessing.config }
                });
                if (response.statusCode !== 200) {
                    continue;
                }
                this._gateways.push(gateway);
            } catch (e) {
                console.error(`Ошибка подключения к '${gateway}'`, e.message);
            }
        }
        console.log("Для пост обработки используются узлы", this._gateways);
    }

    /**
     * Действие при получении новго обработанного файла
     */
    private async _onConsume() {
        const consumed: Record<string, PostProcessCompleteOrder> = DATABASE.get(CONSUMED_KEY);
        // Обрабатываем полученные файлы
        for (const key in consumed) {
            const order = consumed[key];
            try {
                for (const listener of this.listeners("done")) {
                    await listener(key, order);
                }
                DATABASE.delete(`${CONSUMED_KEY}.${key}`);
            } catch(e) {
                console.error(`Ошибка при обработке полученной записи ${key}`, e);
            }
        }
    }

    /**
     * Действие при получении результата постобработки
     * @param files список файлов результата постобработки
     * @param data  дополнительные данные
     */
    private async _onDone(files: string[], { _id: id }: Record<string, string>): Promise<void> {
        if (id === null) {
            console.warn("Идентиификатор не передан");
        } else {
            const order: PostProcessOrder = DATABASE.get(`${PROCESSING_KEY}.${id}`);

            console.log(`Получены обработанные медиафайлы для заказа ${id} типа ${order.name}\n${files.map(
                filePath => `\t${filePath}`).join("\n")}`);

            DATABASE.set(`${CONSUMED_KEY}.${id}`, { order, files });

            DATABASE.delete(`${PROCESSING_KEY}.${id}`);

            await this._onConsume();
        }
    }
    
    /**
     * Действие при ошибке пост обработки медиафайла
     * @param key ключ для получения обработки
     */
    private async _onError(key: string) {
        console.warn(`При обработке файла '${key}' произошла ошибка, удаление обработки...`);
        const processing = DATABASE.get(`${PROCESSING_KEY}.${key}`);
        this.emit("error", key, processing);
        DATABASE.delete(`${PROCESSING_KEY}.${key}`);
    }

    /**
     * Обрабатывает данные полученные из запроса вытягивания
     * @param gateway  адрес узла для запроса
     * @param response ответ на запрос вытягивания
     */
    private _processPullFiles(gateway: string, response: IncomingMessage): Promise<void> {
        return new Promise<void>(async (res, rej) => {
            const bb = busboy({ headers: response.headers });
            const tmpDir = join(PROCESSOR_DIR, v7());
            const files: string[] = [];
            const data: Record<string, string> = {};

            if (!existsSync(tmpDir)) {
                await mkdir(tmpDir, { recursive: true });
            }

            bb.on("file", (name, stream, info) => {
                const newFilePath = join(tmpDir, decodeURIComponent(info.filename));
                files.push(newFilePath);
                stream.pipe(createWriteStream(newFilePath));
            });

            bb.on("field", (name, value) => {
                data[name] = value;
            });

            bb.once("finish", async () => {
                await this._onDone(files, data);
                await rm(tmpDir, { recursive: true });
                res();
            });

            bb.once("error", async err => {
                await rm(tmpDir, { recursive: true });
                rej(err);
            });

            if (response) {
                response.pipe(bb);
            } else {
                return rej(new Error(`Запрос на ${gateway} вернул неожиданный ответ, не содержащий тела ответа`));
            }
        });
    }

    /**
     * Выполняет запрос новых элементов обработчика
     * @param gateway узел для запроса
     */
    private async _pullFiles(gateway: string): Promise<void> {
        console.log(`Получение обработанных файлов с узла "${gateway}"`);
        // Запрашиваем данные с узла
        const data = await fetchOnSuccessGatewayResponse([ gateway ], `/pull/files/${CONFIG.nodeId}`, { method: "GET" });
        // Обрабатываем результат
        await Promise.all(data.map(nodeData => this._processPullFiles(nodeData.gateway, nodeData.response)));
    }

    /**
     * Выполняет запрос новых элементов обработчика
     */
    private async _pullProgress(): Promise<void> {
        let data;
        try {
            data = await fetchOnSuccessGatewayResponse(this._gateways, `/pull/info/${CONFIG.nodeId}`, { method: "GET" });

            // Получаем текущие обработки
            const processings: Record<string, PostProcessOrder> = DATABASE.get(PROCESSING_KEY);
            const gatewaysToPullFiles: Record<string, number> = {};
            const processingInfos: Record<string, MediaProcessingInfo> = {};
            const processingToDelete: string[] = [];

            // Обрабатываем результат
            await Promise.all(data.map(async nodeData => {
                const data = await json(nodeData.response) as Record<string, MediaProcessingInfo>;
                for (const key in data) {
                    const entry = data[key];
                    if (entry.status === 'completed') {
                        if (gatewaysToPullFiles[nodeData.gateway] == null) {
                            gatewaysToPullFiles[nodeData.gateway] = 0;
                        }
                        gatewaysToPullFiles[nodeData.gateway]++;
                    } else if (entry.status === 'error') {
                        processingToDelete.push(key);
                    }
                }
                // Добавляем данные
                Object.assign(processingInfos, data);
            }));

            // Удаляем данные об обработках, в которых произошла ошибка
            for (const key of processingToDelete) {
                this._onError(key);
                delete processings[key];
            }

            // Уведомляем подписчиков обработки
            this.emit("progress", _(processings).entries()
                .map(([ key, order ]) => ({ info: processingInfos[key], order, key })).value());

            // Ожидаем загрузки файлов при необходимости
            for (const [ gateway, count ] of _.entries(gatewaysToPullFiles)) {
                for (let i = 0; i < count; i++) {
                    // Ожидаем загрузки файлов
                    await this._pullFiles(gateway);
                }
            }
        } catch(e) {
            console.error("Ошибка при выполнении запроса получения прогресса пост обработки", e);
        } finally {
            // Выполняем следующий запрос
            setTimeout(this._pullProgress.bind(this), data === null ? PULL_INTERVAL : 1000);
        }
    }
}

/**
 * Данные прогресс обаботки медиафайла
 */
export type MediaProgressData = {
    /** Информация об обработке */
    info?: MediaProcessingInfo;
    /** Заказ на постобработку */
    order: PostProcessOrder;
    /** Ключ пост обработки */
    key: string;
};

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
 * Заказ посотобработки
 */
export type PostProcessOrder = {
    /** Путь до директории назначения */
    dest: string;
    /** Наименование файла назначения */
    name: string;
    /** Дополнительные данные заказа */
    data: Record<string, string>;
}

/**
 * Завершенный заказ посотобработки
 */
export type PostProcessCompleteOrder = {
    /** Заказ посотобработки */
    order: PostProcessOrder;
    /** Список файлов результата постобработки */
    files: string[];
}
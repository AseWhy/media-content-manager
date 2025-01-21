import { CONFIG, ConfigCategoryName, PROCESSOR_DIR, PULL_INTERVAL } from "../../constants";
import { Service } from "typedi";
import { FSDB } from "file-system-db";
import { v7 } from "uuid";
import { basename, join } from "path";
import { createReadStream } from "fs";
import { createWriteStream, existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { json } from "stream/consumers";
import { form, fetch } from "../http";
import { getSystemErrorName } from "util";
import { Writable } from "stream";
import { IncomingMessage } from "http";

import busboy from "busboy";
import EventEmitter from "events";
import FormData from "form-data";

/** База данных обработчика */
const DATABASE = new FSDB("./data/post-processing.json", false);

/**
 * Сервис постобработки
 */
@Service()
export class ProcessingService extends EventEmitter {

    /** Массив действующих на момент инициализации гейтвеев */
    private readonly _gateways: string[] = [];

    /**
     * Конструктор
     */
    constructor() {
        super();
        // Выполняем запрос новых данных раз в 15 секунд
        setTimeout(this._pull.bind(this), PULL_INTERVAL);
    }

    /**
     * Инициализирует сервис постобработки
     */
    public async init(): Promise<void> {
        if (!CONFIG.postProcessing.enabled) {
            return;
        }
        await this._registration();
    }

    /**
     * Добавляет заказ на постобработку
     * @param path        путь до медиафайла для постобработки
     * @param destination директория для сохранения обработанных файлов
     * @param type        тип медиаконтента
     * @param name        имя файла, под которым он будет сохранен после обработки
     */
    async process(path: string, destination: string, name: string, type: ConfigCategoryName): Promise<void> {
        console.log(`Отправка медиафайла "${path}"[${name}] на постобработку`);

        for (const gateway of CONFIG.postProcessing.gateways) {
            try {
                const data = new FormData();

                data.append("file", createReadStream(path), encodeURIComponent(name));

                const response = await form(`${gateway}/add-media/${CONFIG.nodeId}/${type}`, data)

                if (response.statusCode !== 200) {
                    throw new Error("Неожиданный ответ сервера постобработки '" + response.statusCode + "'");
                }

                console.log(`Медиафайл "${path}" успешно отправлен на постобработку`);
                
                const { result: { result, id } }: any = await json(response);
                
                console.log(`Медиафайл "${path}" успешно отправлен на узел ${gateway}. Идентификатор обработки ${id}`);

                if (result !== 'success') {
                    continue
                }

                DATABASE.set(`processing.${id}`, { type, destination });

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
                    body: { config: CONFIG.postProcessing.categories }
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
     * Действие при получении результата постобработки
     * @param files список файлов результата постобработки
     * @param data  дополнительные данные
     */
    private async _onDone(files: string[], { _id: id }: Record<string, string>): Promise<void> {
        if (id === null) {
            console.warn("Идентиификатор не передан");
        } else {
            const order = DATABASE.get(`processing.${id}`);
            const listenerData = { order, files };

            console.log(`Получены обработанные медиафайлы для заказа ${id}`, files, order);

            for (const listener of this.listeners("done")) {
                await listener(listenerData);
            }

            DATABASE.delete(`processing.${id}`);
        }
    }

    /**
     * Обрабатывает данные полученные из запроса вытягивания
     * @param gateway  адрес узла для запроса
     * @param response ответ на запрос вытягивания
     */
    private _prcessPull(gateway: string, response: IncomingMessage): Promise<void> {
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
            });

            bb.once("error", async err => {
                await rm(tmpDir, { recursive: true });
                rej(err);
            });

            bb.on("close", res);

            if (response) {
                response.pipe(bb);
            } else {
                return rej(new Error(`Запрос на ${gateway} вернул неожиданный ответ, не содержащий тела ответа`));
            }
        });
    }

    /**
     * Выполняет запрос новых элементов обработчика
     */
    private async _pull(): Promise<void> {
        let activated = false;
        for (const gateway of this._gateways) {
            try {
                const response = await fetch(`${gateway}/pull/${CONFIG.nodeId}`, { method: "GET" });

                if (response.statusCode === 200 && response.headers["content-length"] !== '0') {
                    console.log("Обработка ответа данных с узла", gateway);
    
                    await this._prcessPull(gateway, response);
    
                    activated = true;
                }
            } catch(e) {
                console.error(`Ошибка подключения к '${gateway}'`, e);
            }
        }
        // Выполняем следующий запрос
        setTimeout(this._pull.bind(this), activated ? 1000 : PULL_INTERVAL);
    }
}

/**
 * Заказ посотобработки
 */
export type PostProcessOrder = {
    /** Путь до директории назначения */
    destination: string;
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
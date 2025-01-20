import { CONFIG, ConfigCategoryName } from "../../constants";
import { Service } from "typedi";
import { FSDB } from "file-system-db";
import { v7 } from "uuid";
import { basename, join } from "path";
import { tmpdir } from "os";
import { createWriteStream, existsSync } from "fs";
import { mkdir, rm } from "fs/promises";

import busboy from "busboy";
import fetch, { blobFrom, FetchError, FormData } from "node-fetch";
import EventEmitter from "events";
import { Agent } from "http";

/** Интервал обновления данных */
const PULL_INTERVAL = 15000;

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
    public async init() {
        if (!CONFIG.postProcessing.enabled) {
            return;
        }
        await this._registration();
    }

    /**
     * Добавляет заказ на постобработку
     * @param order заказ
     */
    async process({ type, path }: PostProcessOrder) {
        const data = new FormData();

        data.append("file", await blobFrom(path.source), basename(path.source));

        const url = `/add-media/${CONFIG.nodeId}/${type}`;
        const init = { method: "POST", body: data, agent: new Agent({ timeout: 0 }) };

        console.log(`Отправка "${path.source}" на постобработку`);

        for (const gateway of this._gateways) {
            try {
                const response = await fetch(gateway + url, init);
                if (response.status !== 200) {
                    throw new Error("Неожиданный ответ сервера постобработки '" + response.statusText + "'");
                }

                const { result: { result, id } }: any = await response.json();

                if (result === 'success') {
                    DATABASE.set(`processing.${id}`, { type, path });
                    return;
                }
            } catch(e) {
                if (e instanceof FetchError && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET')) {
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
    private async _registration() {
        const body = JSON.stringify({
            config: CONFIG.postProcessing.categories
        });
        const headers = new Headers();
        headers.set("Content-Type", "application/json");
        for (const gateway of CONFIG.postProcessing.gateways) {
            try {
                const response = await fetch(`${gateway}/register/${CONFIG.nodeId}`, { method: "POST", body, headers });
                if (response.status === 200) {
                    this._gateways.push(gateway);
                }
            } catch (e) {
                console.error(`Ошибка подключения к '${gateway}'`, e.message);
            }
        }
    }

    /**
     * Действие при получении результата постобработки
     * @param files список файлов результата постобработки
     * @param data  дополнительные данные
     */
    private async _onDone(files: string[], { _id: id }: Record<string, string>) {
        if (id === null) {
            console.warn("Идентиификатор не передан");
        } else {
            const order = DATABASE.get(`processing.${id}`);
            const listenerData = { order, files };

            for (const listener of this.listeners("done")) {
                await listener(listenerData);
            }
        }
    }

    /**
     * Выполняет запрос новых элементов обработчика
     */
    private async _pull() {
        let activated = false;
        for (const gateway of this._gateways) {
            try {
                const response = await fetch(`${gateway}/pull/${CONFIG.nodeId}`, { method: "GET" });

                if (response.status !== 200 || response.headers.get("content-length") === '0') {
                    continue;
                }

                await new Promise<void>(async (res, rej) => {
                    const headers = Object.fromEntries(Object.entries(response.headers.raw()).map(([ key, value ]) =>
                        [ key, value.join("") ]));
                    const bb = busboy({ headers });
                    const tmpDir = join(tmpdir(), v7());
                    const files: string[] = [];
                    const data: Record<string, string> = {};

                    if (!existsSync(tmpDir)) {
                        await mkdir(tmpDir, { recursive: true });
                    }

                    bb.on("file", (name, stream, info) => {
                        const newFilePath = join(tmpDir, info.filename);
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

                    if (response.body) {
                        response.body.pipe(bb);
                    } else {
                        console.error(`Запрос на ${gateway} вернул неожиданный ответ, не содержащий тела ответа`);
                    }
                });

                activated = true;
            } catch(e) {
                console.error(`Ошибка подключения к '${gateway}'`, e.message);
            }
        }
        // Выполняем следующий запрос
        setTimeout(this._pull.bind(this), activated ? 0 : PULL_INTERVAL);
    }
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

/**
 * Заказ посотобработки
 */
export type PostProcessOrder = {
    /** Конфигурация пути */
    path: PostProcessOrderPath;
    /** Тип категории */
    type: ConfigCategoryName;
}

/**
 * Конфигурация пути до обрабатываемого файла
 */
export type PostProcessOrderPath = {
    /** Путь до файла источника */
    source: string;
    /** Путь до директории назначения */
    destination: string;
}
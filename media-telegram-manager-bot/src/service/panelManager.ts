import { MessageWorker } from "./messageWorker";
import { ProgressBar } from "./progressBar";
import { ChatId } from "node-telegram-bot-api";
import { Service } from "typedi";
import { toLength } from ".";

import _, { type DebouncedFunc, type DebouncedFuncLeading } from "lodash";
import humanFormat from "human-format";
import formatDuration from "format-duration";

/** Интервал обновления панели */
const PANEL_UPDATE_INTERVAL = 5000;

/**
 * Менеджер панелей
 */
@Service()
export class PanelManager {

    /** Данные панели */
    private panels: { [key: string]: Panel } = {};

    /**
     * Возвращает панель из перечня панелей
     * @param chatId идентификатор чата
     * @returns панель
     */
    public getPanel(chatId: ChatId) {
        let key = _.toString(chatId);
        let panel = this.panels[key];
        if (panel == null) {
            panel = this.panels[key] = new Panel(new MessageWorker(chatId, true));
        }
        return panel;
    }
}

/**
 * Панель
 */
export class Panel {

    /** Данные панели */
    private _data: { [key: string]: PanelDownloadData | PanelPostProcessingData } = {};

    /** Индикатор прогресса загрузки */
    private _bars: { [key: string]: ProgressBar } = {};

    /** Функция обновления сообщения с панелью */
    private __update: DebouncedFuncLeading<VoidFunction> | DebouncedFunc<VoidFunction>;

    /** Последний установленный интервал обновления панели */
    private __lastInterval: number;

    /**
     * Конструктор
     * @param [_worker=null] воркер для работы с панелью
     */
    constructor(private readonly _worker: MessageWorker) {
        this.__lastInterval = PANEL_UPDATE_INTERVAL;
        this.__update = _.throttle(this._update, this.__lastInterval);
    }

    /**
     * Добавляет данные загрузки
     * @param downloadingId идентификатор загрузки
     */
    public add(downloadingId: string, data: PanelDownloadData | PanelPostProcessingData) {
        const prevData = this._data[downloadingId];

        this._data[downloadingId] = data;
        this._bars[downloadingId] = this._bars[downloadingId] ?? new ProgressBar(100);

        if (prevData == null || prevData.name != data.name || prevData.progress != data.progress ||
            prevData instanceof PanelDownloadData && data instanceof PanelDownloadData && prevData.speed != data.speed) {
            this.__update();
        }
    }

    /**
     * Удаляет данные загрузки
     * @param downloadingId идентификатор загрузки
     */
    public remove(downloadingId: string) {
        const prevData = this._data[downloadingId];
        const prevBars = this._bars[downloadingId];
        if (prevData != null || prevBars != null) {
            delete this._data[downloadingId];
            delete this._bars[downloadingId];
            this.__update();
        }
    }

    /**
     * Пересоздает панель
     */
    public recreate(): void {
        this._worker.forgetLastMessage();
    } 

    /**
     * Обновляет сообщение с панелью
     */
    private async _update() {
        const entries = Object.entries(this._data);
        const message = this._message(entries);
        try {
            await this._worker.send(message);
        } catch(e) {
            // Очищаем от предыдущих вызовов
            this.__update.cancel();
            // Увеличиваем интервал обновления
            this.__lastInterval = Math.min(this.__lastInterval + 1000000, 25000000);
            // Увеличиваем время до следующего обновления панели
            this.__update = _.throttle(this._update, this.__lastInterval, { leading: false });
            // Уведомляем о смене интервала
            console.error(`Интервал обновления увеличен до '${this.__lastInterval}'`);
            // Выводим ошибку
            console.error(e.message);
            // Не выполняем дальше
            return;
        }
        if (this.__lastInterval != PANEL_UPDATE_INTERVAL) {
            // Очищаем от предыдущих вызовов
            this.__update.cancel();
            // Уменьшаем интервал
            this.__lastInterval = Math.max(this.__lastInterval - 1000000, PANEL_UPDATE_INTERVAL);
            // Уменьшаем время до следующего обновления панели
            this.__update = _.throttle(this._update, this.__lastInterval, { leading: false });
            // Уведомляем о смене интервала
            console.error(`Интервал обновления уменьшин до '${this.__lastInterval}'`);
        }
        if (entries.length === 0) {
            this._worker.forgetLastMessage();
        }
    }

    /**
     * Формирует сообщение с панелью для отправки пользователю
     * @param entries элементы панели
     * @returns сообщение с панелью
     */
    private _message(entries: [string, PanelDownloadData | PanelPostProcessingData][]) {
        if (entries.length === 0) {
            return "Все данные успешно загружены\\!";
        }

        let computedSpeed = 0;
        let computedRest = 0;
        let computedDownloaded = 0;
        let computedSize = 0;

        const downloading: string[] = [];
        const processing: string[] = [];

        for (const [ downloadingId, data ] of _.sortBy(entries, "name")) {
            const progressBar = this._bars[downloadingId];
            const computedName = toLength(data.name, 64);

            progressBar.set(data.progress);

            if (data instanceof PanelDownloadData) {
                if (data.isSubsection) {
                    downloading.push(`${computedName}: ${progressBar.render()} [${humanFormat(data.downloaded)} из ${humanFormat(data.size)}] (${
                        data.progress.toFixed(2)}%)`);
                } else {
                    downloading.push(`${computedName}: ${progressBar.render()} [${humanFormat(data.downloaded)} из ${humanFormat(data.size)}] ${
                        humanFormat(data.speed)}/S (${data.progress.toFixed(2)}%)`);

                    computedSpeed += data.speed;
                    computedDownloaded += data.downloaded;
                    computedSize += data.size;
                    computedRest += (data.size - data.downloaded) / data.speed * 1000;
                }
            } else {
                processing.push(`${computedName}: ${progressBar.render()} +${data.speed.toFixed(4)}%/S (${
                    data.progress.toFixed(2)}%) до завершения ${formatDuration((100 - data.progress) / data.speed * 1000)}`);
            }
        }

        if (downloading.length !== 0) {
            downloading.unshift(`Выполняется загрузка... [${humanFormat(computedDownloaded)} из ${humanFormat(computedSize)}] ${
                humanFormat(computedSpeed)}/S (${(computedDownloaded / computedSize * 100).toFixed(2)}%) до завершения загрузки ${
                    formatDuration(computedRest)}\n`);
        }

        if (processing.length !== 0) {
            processing.unshift(`Выполняется пост обработка...\n`);
        }

        return [downloading, processing].map(e => `\`\`\`\n${e.join("\n")}\`\`\``).join("\n");
    }
}

/**
 * Данные отображения панели загрузки
 */
export class PanelDownloadData {

    /**
     * Конструктор
     * @param name         наименование загрузки
     * @param speed        скорость загрузки
     * @param size         размер файла
     * @param downloaded   размер загруженных файлов
     * @param progress     прогресс загрузки
     * @param isSubsection признак подраздела
     */
    constructor(public readonly name: string, public readonly speed: number, public readonly size: number,
        public readonly downloaded: number, public readonly progress: number, public readonly isSubsection: boolean) {

    }
}

/**
 * Данные отображения панели пост обработки
 */
export class PanelPostProcessingData {

    /**
     * Конструктор
     * @param name     наименование обработки
     * @param progress прогресс конвертации
     * @param speed    скорость обработки (% в секунду)
     */
    constructor(public readonly name: string, public readonly progress: number, public readonly speed: number) {

    }
}
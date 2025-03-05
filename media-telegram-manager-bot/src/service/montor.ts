import { setTimeout } from "timers/promises";
import { PersistentStore } from "./persistentStore";

/**
 * Класс монитора, используется для сохращения количества вызовов к функции монитора
 */
export class Monitor<T extends (data: PersistentStore) => Promise<any>> {

    /** Текущий вызов монитора */
    private _currentCall: Promise<any> | undefined;

    /** Признак необходимости совершить следующий вызов после завершения текущего */
    private _requiresNewCallAfterComplete: boolean = false;

    /** Метка времени последнего вызова функции монитора */
    private _lastMonitorCallTime: number = 0;

    /** Признак закрытого монитора */
    private _closed: boolean = false;

    /**
     * Конструктор
     * @param _monitorFunc             функция обнолвения параметров монитора
     * @param [_newCallInterval=0]     интервал вызова функции монитора в мс
     * @param _store                   хранилище постоянных данных монитора
     */
    constructor(private readonly _monitorFunc: T, private readonly _newCallInterval: number = 0, private _store: PersistentStore) {

    }

    /**
     * Выполняет вызов функции монитора
     */
    private async _doCall() {
        const nextCallTs = this._lastMonitorCallTime + this._newCallInterval;
        const now = Date.now();
        if (nextCallTs > now) {
            // Ожидаем разницу времени до следующего вызова
            await setTimeout(nextCallTs - now);
        }
        this._lastMonitorCallTime = Date.now();
        this._requiresNewCallAfterComplete = false;
        try {
            await this._monitorFunc(this._store);
        } finally {
            if (this._requiresNewCallAfterComplete) {
                // Тогда ожидаем ещё и следующий вызов
                await this._doCall();
            }
        }
    }

    /**
     * Выполняет запрос на вызов функции монитора
     */
    public call(): void {
        if (this._closed) {
            return;
        }

        if (this._currentCall) {
            this._requiresNewCallAfterComplete = true;
            return;
        }

        // Обработчик вызова функции монитора
        this._currentCall = this._doCall()
            .finally(() => this._currentCall = undefined);
    }

    /**
     * Завершает работу монитора
     */
    public close(): void {
        this.call();
        this._closed = true;
        this._store.delete();
    }
}
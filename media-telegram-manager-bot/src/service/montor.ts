import { setTimeout } from "timers/promises";

/**
 * Класс монитора, используется для сохращения количества вызовов к функции монитора
 */
export class Monitor<D, T extends (data: D) => Promise<any>> {

    /** Текущий вызов монитора */
    private _currentCall: Promise<any> | undefined;

    /** Признак необходимости совершить следующий вызов после завершения текущего */
    private _requiresNewCallAfterComplete: boolean = false;

    /** Метка времени последнего вызова функции монитора */
    private _lastMonitorCallTime: number = 0;

    /**
     * Конструктор
     * @param _monitorFunc             функция обнолвения параметров монитора
     * @param [_monitorData=undefined] данные для вызова функции монитора
     * @param [_newCallInterval=0]     интервал вызова функции монитора в мс
     */
    constructor(private readonly _monitorFunc: T, private readonly _monitorData: D, private readonly _newCallInterval: number = 0) {

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
            await this._monitorFunc(this._monitorData);
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
        if (this._currentCall) {
            this._requiresNewCallAfterComplete = true;
            return;
        }
        // Обработчик вызова функции монитора
        this._currentCall = this._doCall().finally(() => {
            this._currentCall = undefined;
        });
    }
}
/**
 * Класс индикатора скорости увеличения значения
 */
export class SpeedIndicator {

    /** Временная метка получения последнего значения */
    private _lastValueAt: number = Date.now();

    /** Скорость увеличения значения, по сравнению с предыдущим */
    private _speed: number = 0;

    /**
     * Конструктор
     * @param _lastValue последнее полученное значение
     */
    constructor(private _lastValue: number = 0) {
    }

    /**
     * Обновляет значение 
     * @param newValue 
     */
    public update(newValue: number): void {
        const now = Date.now();
        const delta = (now - this._lastValueAt) / 1000;
        this._speed = (newValue - this._lastValue) / delta;
        this._lastValue = newValue;
        this._lastValueAt = now;
    }

    /**
     * Возвращает скорость увеличения значения
     */
    get speed(): number {
        return this._speed;
    }
}
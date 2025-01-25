/** Символы прогресса загрузки */
const SYMBOLS = [ "█", "▇", "▆", "▅", "▄", "▃", "▂" ];

/**
 * Класс индикатора прогресса
 */
export class ProgressBar {

    /** Текущее значение прогресса */
    private _current: number;

    /**
     * Конструктор
     * @param _total  максимальное значение програесса
     * @param _length длинна прогресс бара в символах
     */
    constructor(private _total: number, private _length: number = 17) {
        this._current = 0;
    }

    /**
     * Добавляет значение прогресса
     * @param delta значение прогресса
     */
    public add(delta = 1): void {
        this.set(this._current + Math.abs(delta));
    }

    /**
     * Вычитает значение прогресса
     * @param delta значение прогресса
     */
    public subtract(delta = 1): void {
        this.set(this._current - Math.abs(delta));
    }

    /**
     * Устанавливает текущее значение прогресса
     * @param value текущее значение прогресса
     */
    public set(value: number): void {
        this._current = Math.max(Math.min(value, this._total), 0);
    }

    /**
     * Возвращает текущее значение прогресса
     */
    public get current() {
        return this._current;
    }

    /**
     * Выполняет отрисовку значения прогресса
     * @returns отрисованное значение прогресса
     */
    public render(): string {
        const absolute = Math.trunc(this._current / this._total * ((this._length - 1)* SYMBOLS.length));
        const result: string[] = [];
        for (let i = 1; i < this._length; i++) {
            const progress = i * SYMBOLS.length;
            if (progress > absolute) {
                if (progress - SYMBOLS.length < absolute) {
                    result.push(SYMBOLS[SYMBOLS.length - absolute % SYMBOLS.length])
                } else {
                    result.push(" ");
                }
            } else {
                result.push(SYMBOLS[0])
            }
        }
        return result.join("");
    }
}
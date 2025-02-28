/**
 * Постоянное хранилище
 */
export interface PersistentStore {

    /**
     * Возвращает данные из хранилища
     * @param key ключ
     */
    get<T>(key?: string): T;
    
    /**
     * Устанавливает данные в хранилище
     * @param key  ключ
     * @param data данные для установки
     */
    set(key?: string, data?: any): void;

    /**
     * Удаляет данные из хранилища
     * @param key ключ
     */
    delete(key?: string): void;
}

/**
 * Адаптер для постоянного хранилища
 */
export class PersistentStoreAdapter implements PersistentStore {

    /**
     * Конструктор
     * @param _delegate делегат
     * @param _prefix   префикс для вызова методов установки и получения данных
     */
    constructor(private readonly _delegate: PersistentStore, private readonly _prefix: string) {

    }

    /**
     * Возвращает отформатированный ключ
     * @param key ключ
     * @returns отформатированный ключ
     */
    private key(key: string) {
        return this._prefix.replace(/\.+$/g, "") + (key ? "." + key : "");
    }

    /** @inheritdoc */
    public get<T>(key: string): T {
        return this._delegate.get(this.key(key));
    }

    /** @inheritdoc */
    public set(key: string, data: any): void {
        this._delegate.set(this.key(key), data);
    }

    /** @inheritdoc */
    public delete(key: string): void {
        this._delegate.delete(this.key(key));
    }
}
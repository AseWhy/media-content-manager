import { FSDB } from "file-system-db";
import { ProcessingType } from "../contants";
import { Service } from "typedi";

/** База данных обработчика */
const DATABASE = new FSDB("./data/customers.json", false);

/**
 * Регистр заказчиков обработки
 */
@Service()
export class CustomerRegistry {

    /**
     * Возвращает конфигурация заказчика обработки
     * @param nodeId идентификатор узла
     * @returns конфигурация заказчика обработки
     */
    public get(nodeId: string): Customer {
        return DATABASE.get(nodeId);
    }

    /**
     * Добавляет заказчика обработки
     * @param nodeId   идентификатор узла
     * @param customer заказчк обработки
     */
    public set(nodeId: string, customer: Customer): void {
        DATABASE.set(nodeId, customer);
    }
}

/**
 * Параметры заказчика посмтобработки
 */
export type Customer = {
    /** Реле для ответов */
    readonly relay: string;
    /** Конфигурация обработки для этого заказчика */
    readonly config: Record<ProcessingType, any>;
}
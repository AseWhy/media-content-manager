import { ProcessingType } from "../../../contants";
import { CustomerConfig } from "../../customerRegistry";

/**
 * Структура заказа постобработки
 */
export type CustomerOrder = {
    /** Тип постобработки */
    type: ProcessingType;
    /** Заказчик обработки медиафайла */
    customer: string;
    /** Путь до медиафайла */
    pathToMedia: string;
    /** Наименование медиа */
    name: string;
    /** Конфигурация постобработки */
    config: CustomerConfig;
}

/**
 * Данные обрабатываемого заказа
 */
export type CustomerOrderProcessing = CustomerOrder & {
    /** Директория в которой находятся файлы */
    directory: string;
    /** Список путей до обработанных медиафайлов */
    result: string[];
    /** Идентификатор обработки */
    id: string;
}

/**
 * Обработчик медиа
 */
export interface MediaProcessor {

    /**
     * Запускает обработку медиа
     * @param id    идентификатор обработки
     * @param order заказ на обработку
     */
    process(id: string, order: CustomerOrder): Promise<void>;
}
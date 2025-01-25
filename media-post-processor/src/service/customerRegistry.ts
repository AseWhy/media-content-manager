import { FSDB } from "file-system-db";
import { ProcessingType, VideoCodecType } from "../contants";
import { Service } from "typedi";
import { Schema } from "jsonschema";

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
    readonly config: Record<ProcessingType, VideoCustomerConfig>;
}

/** Конфигурация заказчика */
export type CustomerConfig = VideoCustomerConfig;

/**
 * Конфигурая разрешений для пост-обработки видео
 */
export type VideoOutputConfig = {
    /** Условие создания выхода */
    mode: "always" | "first";
    /** Доступные имена выходов */
    names: string[];
}

/**
 * Конфигурая для пост-обработки видео
 */
export type VideoCustomerConfig = {
    /** Конфигурация выходов */
    outputs: VideoOutputConfig,
    /** Карта, где ключ это тип потока а значение это схема для фильтрации потоков этого типа */
    stream: VideoCustomerStreamConfig;
}

/**
 * Конфигурация видео потока заказчика
 */
export type VideoCustomerStreamConfig = Record<VideoCodecType, Schema>;
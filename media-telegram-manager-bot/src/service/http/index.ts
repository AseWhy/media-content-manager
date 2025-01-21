import { type IncomingMessage, request } from "http";

import FormData from "form-data";

/**
 * Выполняет запрос
 * @param url     url запроса
 * @param options опции запроса
 */
export function fetch(url: string, options: FetchOptions): Promise<IncomingMessage> {
    return new Promise((res, rej) => {
        const httpRequest = request(url, { method: options.method, headers: options.headers });

        if (options.body instanceof FormData) {
            httpRequest.setHeaders(new Map(Object.entries(options.body.getHeaders())));
            options.body.pipe(httpRequest, { end: true });
        } else {
            if(options.method != "GET") {
                const data = Buffer.from(JSON.stringify(options.body), "utf8");
    
                httpRequest.setHeader("Content-Length", data.byteLength);
                httpRequest.setHeader("Content-Type", "application/json");
    
                httpRequest.write(data);
            }
            httpRequest.end();
        }

        httpRequest.on("response", res);
        httpRequest.on("error", rej);
    })
}

/**
 * Отправляет данные формы на удаленный хост
 * @param url  url для отправки формы
 * @param data данные форсы
 * @returns 
 */
export function form(url: string, data: FormData): Promise<IncomingMessage> {
    return fetch(url, { body: data, method: "POST" });
}

/**
 * Json поле
 */
export type JsonDataField = Record<string, JsonData | string | number>;

/**
 * Данные в формате json
 */
export interface JsonData extends JsonDataField {

}

/**
 * Опции для выполнения запроса
 */
export type FetchOptions = {
    /** Метод запроса */
    method?: "POST" | "GET";
    /** Заголовки запроса */
    headers?: Record<string, string>;
    /** Тело запроса */
    body?: FormData | JsonData;
}
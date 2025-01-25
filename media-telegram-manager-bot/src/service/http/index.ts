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
    
                httpRequest.write(data, error => {
                    if (error) {
                        return rej(error);
                    }
                    httpRequest.end();
                });
            } else {
                httpRequest.end();
            }
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
 * Выполняет запрос на переданный массив узлов, массив успешных ответов от узлов
 * @param gateways массив узлов запроса
 * @param path     путь для запроса для каждого узла
 * @param options  опции запроса
 */
export async function fetchOnSuccessGatewayResponse(gateways: string[], path: string, options: FetchOptions): Promise<SingleSuccessGateway[]> {
    const result: SingleSuccessGateway[] = [];
    for (const gateway of gateways) {
        try {
            const response = await fetch(gateway + path, options);
            if (response.statusCode !== 200) {
                continue;
            }
            console.log(`Получен ответ при запросе ${gateway} [${path}] => ${response.statusCode}`);
            result.push({ gateway, response });
        } catch(e) {
            console.error(`Ошибка запроса к '${gateway}' [${path}]`, e);
        }
    }
    return result;
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
 * Результат запроса на узел
 */
export type SingleSuccessGateway = {
    /** Адрес узла */
    gateway: string;
    /** Полученный ответ от узла */
    response: IncomingMessage;
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
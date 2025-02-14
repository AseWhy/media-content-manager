import * as lib from "../lib";

/**
 * Возвращает замыкание аналогично `Function`, вызываемое замыкание дополнительно передает библиотеку расширения в вызываемую функцию
 * @param params параметры вызова функции
 * @returns замыкание
 */
export function execute(...params: string[]) {
    const delegate = Function("lib", ...params);
    return (...args: any[]) => delegate(lib, ...args);
}
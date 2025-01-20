/**
 * Формирует текстовое сообщение из списка сущностей
 * @param header заголовок списка
 * @param data   данные списка
 * @param mapper функция преобразователя данных в строку
 * @returns сформированное сообщение
 */
export function listContent<T>(header: string, data: T[], mapper: (data: T, i: number) => string | string[]) {
    const result = [ header + "\n" ];
    const count = data.length;
    for (let i = 0; i < count; i++) {
        const entry = data[i];
        const mapperResult = mapper(entry, i);
        if (typeof mapperResult === 'string') {
            result.push(mapperResult);
        } else {
            result.push(...mapperResult);
        }
    }
    return result.join("\n");
}

/**
 * Добавляет к содержимому команду отмены
 * @param input вхоядщая строка
 * @returns содержимое с командой отмены
 */
export function cancelable(input: string) {
    return input + "\n\n[/cancel]"
}

/**
 * Приводит строку к фиксированной длинне
 * @param input  вхоядщая строка
 * @param length нужная длинна
 * @returns строка фиксированной длинны
 */
export function toLength(input: string, length: number = 20) {
    if (input.length < length) {
        input = input.padEnd(length, " ")
    }
    if (input.length > length) {
        input = input.substring(0, length - 3) + "...";
    }
    return input;
}
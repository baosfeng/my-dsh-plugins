/**
 * dsh-shared — HTTP helpers shared by plugin routes: bounded JSON body
 * reading and JSON responses. 由各插件 lib/http.js 抽取合并（issue #45），
 * 行为与抽取前逐字节一致。
 */
import type { ServerResponse } from './types.js';
/** Read a JSON request body (bounded). */
export declare function readJsonBody(request: AsyncIterable<string>): Promise<Record<string, unknown>>;
export declare function writeJson(response: ServerResponse, status: number, value: unknown): void;
export declare function writeError(response: ServerResponse, error: unknown): void;

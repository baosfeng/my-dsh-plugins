import type { ConfigDict } from './types.js'
/** Profile 名：进程参数 --profile 优先，否则默认 web（与 dsh-my-plugin-manager 同契约）。 */
export declare function currentProfile(): string
/** Profile 目录：$DSH_HOME/profiles/<profile>（fallback ~/.dsh/profiles/…）。 */
export declare function profileDirOf(profile: string): string
/** 用户层 patch 文件路径（watchUserPatches 监听的 profile 层文件）。 */
export declare function patchFileOf(profile: string): string
/** 从 patch 文件文本提取指定行 id 的 config 块；无条目/无 config 返回 undefined。 */
export declare function extractConfig(text: string, rowId: string): ConfigDict | undefined
/** 把 config 写入 patch 文件：删除同 id 旧条目，追加新条目，原子写。 */
export declare function writePatchConfig(file: string, rowId: string, config: ConfigDict): Promise<void>

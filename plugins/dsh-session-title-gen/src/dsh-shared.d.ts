/**
 * dsh-shared — 手写模块声明（纯 JS 包，无 .d.ts）。
 *
 * 声明本插件用到的 dsh-shared 导出，使 TypeScript 编译期可检查。
 */

declare module 'dsh-shared' {
  /** 向上查找最近的 .git 祖先目录，返回项目根绝对路径。 */
  export function findProjectRoot(cwd: string): Promise<string>
}

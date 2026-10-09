# TypeScript 插件的构建链（tsc 双配置 + 注入模板）

> 承接 [../SKILL.md](../SKILL.md) 的「TypeScript 开发（TS 插件）」一节。本仓库插件**全部**是 TS 开发，任何一个现有插件都可以整目录照抄；本文件只写照抄时最容易漏的构建链事实。

## 照抄起点

| 形态 | 照抄对象 |
| --- | --- |
| 纯 server（无 client 半） | `plugins/dsh-my-remote/`（`tsconfig.json` + `src/index.ts`） |
| server + client 页签/预览器（最常见） | `plugins/dsh-my-observability/`（`tsconfig.json` + `tsconfig.client.json` + `lib/client.src.js` + `scripts/build.mjs`）；要注入 `dsh-shared/client-parts` 共享片段时看 `plugins/dsh-mermaid-render/scripts/build.mjs` |
| 共享工具库（`dsh.kind=library`） | `plugins/dsh-shared/` |

新建时改三处即可：目录名、`package.json` 的 `name`、`cordis.patch.yml` 的 `id`/`name`（见 [package-and-patch.md](package-and-patch.md)）。

## 两个 tsconfig（职责分离）

```jsonc
// tsconfig.json —— server 半：src/**/*.ts → lib/*.js（ESM，产物提交）
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "lib",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts"],
  "exclude": ["src/client"]
}
```

```jsonc
// tsconfig.client.json —— client 半：src/client/**/*.ts → lib/.client-build/*.js（CommonJS，注入后即弃）
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "commonjs",
    "moduleResolution": "bundler",
    "outDir": "lib/.client-build",
    "rootDir": "src/client",
    "lib": ["es2022", "dom"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": []
  },
  "include": ["src/client/**/*.ts"]
}
```

根 `tsconfig.json` 只做全仓 `tsc --noEmit` 类型检查（CI 阻断）；上面两个只负责 emit。

## 构建步骤（`scripts/build.mjs`）

```bash
npx tsc -p tsconfig.json          # server 半 → lib/*.js
npx tsc -p tsconfig.client.json   # client 半 → lib/.client-build/index.js（CommonJS 单文件）
node scripts/build.mjs            # 把上面产物注入 lib/client.src.js 的占位符 → lib/client.js
```

- 占位符形如 `/*__CLIENT_BUNDLE__*/`（共享片段另有 `__PART_ICONS__` / `__PART_STYLE_TAG__` 等），**必须"恰好一处且不在注释里"**——注入进注释或重复注入都会静默失效，固化为 `dsh-shared/scripts/splice.mjs` 的 `spliceExactlyOnce` / `isPlaceholderOutsideComments`。
- 替换必须用**函数 replacer**（`replaceAll(p, () => bundle)`）：字符串 replacer 会把产物里的 `$&` / `$1` 当特殊模式吞掉。
- CommonJS 产物内联进 `__ModuleLoader__` factory 作用域后，`require` / `exports` / `module` 都是作用域变量，可运行；client 端 TS 源码保持**单文件**（无运行时相对 import），多文件打包才上 esbuild/tsdown。

## 必须提交的产物

- `lib/index.js`、`lib/client.js` **提交**：CI 只跑 `node --check` + 测试，不跑构建；漏提交 → 测试跑的是旧产物。
- 改了 `src/**` 必须重跑 `npm run build` 并一起提交（门禁只校验产物与源码同源，不会替你重新构建）。
- tsc 产物加入 `.prettierignore` 与 `eslint.config.js` ignores，否则 lint-staged 会改写产物、造成"源码没改产物却变了"。

## 踩坑

- `module: nodenext` 下相对 import 必须写 `.js` 扩展名（tsc 映射到 `.ts` 源码）；`moduleResolution: node10` 已被 TS 7 移除，用 `nodenext` / `bundler`。
- 注释里不要出现未闭合的 `/*`（提前闭合块注释 → TS1127）。
- typescript-eslint 尚不兼容 TS 7：`eslint` 只查 JS，TS 由 `tsc` 负责，别指望 eslint 抓 TS 类型错。
- `ctx` / `webServer` / `sidebarRightTabs` 等运行时契约**不装类型包**，在 `src/types.d.ts`（server 半）与 `src/client/globals.d.ts`（client 半）手写最小声明。

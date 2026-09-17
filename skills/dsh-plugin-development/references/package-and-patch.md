# package.json 关键字段与 cordis.patch.yml

> 承接 [../SKILL.md](../SKILL.md) 的「开发流程」第 2 步与「目录结构规范」；bundle 装载与依赖声明的完整字段说明在本文件（被移出的正文逐字保留）。

## package.json 关键字段

```jsonc
{
  "name": "dsh-<功能>",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json",
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "CHANGELOG.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime"] },
  },
  "peerDependencies": {
    "cordis": "^4.0.0-rc.10",
    "react": "^18.2.0 || ^19.3.0",
  },
  "peerDependenciesMeta": {
    "cordis": { "optional": true },
  },
  "scripts": { "test": "node test/host-smoke.mjs" },
}
```

要点：

- `dsh.bundle.patch` 指向的 `cordis.patch.yml` 会被 `dsh plugin add` 自动应用，**不要在 profile 里手动重复 insert 同一行**（会报 duplicate loader entry）。
- peer 依赖（cordis / react）由宿主 profile 提供；`optional: true` 表示缺省也可加载（注册代码判空跳过）。**不声明任何第三方侧边栏包**——侧边栏能力全部经宿主服务名获取。

## cordis.patch.yml

```yaml
- insert:
    - id: <插件短名>
      name: '<包名>'
```

`id` 在 profile 内全局唯一。挂载行只负责装载：不要在这里写配置，配置经 `config` 字段且由插件自行校验。

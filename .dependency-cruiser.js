/** dependency-cruiser 配置：质量门禁第 6 项（依赖结构分析）。 */
export default {
  forbidden: [
    {
      name: 'no-circular',
      comment: '禁止循环依赖（A→B→A）',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-lib-cross-import',
      comment: 'lib 内部 server/client 不互相依赖（index.js 与 client.js 独立打包）',
      severity: 'error',
      from: { path: 'plugins/[^/]+/lib/index\\.js$' },
      to: { path: 'plugins/[^/]+/lib/client' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // 压缩产物不参与依赖分析（issue #330 自查发现）：dsh-mermaid-render 的
    // `vendor/mermaid.min.js` 与 `assets/mermaid-10.9.3.min.js` 各 3.3MB（单行 UMD），
    // 不是本仓库代码、没有可判定的依赖边，但每次 depcruise 都要解析它们。
    // 实测（本机）：排除前 2191ms / 531 模块 → 排除后 1297ms / 529 模块。
    // 同类问题的判据是「耗时异常先查是不是在扫不该扫的东西」，而不是急着并发化——
    // eslint 的 ignores 也曾漏掉 `plugins/*/assets/*.min.js`（issue #322 修复）。
    // 工具临时产物同样不参与依赖分析：`coverage/`（vitest 覆盖率）、`.stryker-tmp/`（变异测试
    // sandbox）、`reports/`（Stryker 报告）都是**运行期被创建/删除**的目录，遍历时扫到半截会
    // ENOENT；`lib/.client-build/` 是 client 构建中间产物。这与 eslint / prettier / jscpd 的
    // ignores 保持一致（issue #330 自查：只排 vendor/assets 是不够的）。
    exclude: { path: '(^|/)(vendor|assets|coverage|reports|\\.stryker-tmp|\\.client-build)/' },
    includeOnly: '^plugins/',
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
}

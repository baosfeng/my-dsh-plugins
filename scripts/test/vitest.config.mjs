// scripts 测试专用 Vitest 配置：覆盖率统计 scripts/lib/ 下的纯函数模块
// （release-checks.mjs = 发版校验，issue #39；npm-audit.mjs = audit 门禁判定，issue #199；
// verify-profile.mjs = 隔离 profile 软链与解析路径校验，issue #220；
// screenshot-gate.mjs = README 效果图门禁判定与无 UI 豁免判据，issue #227；
// preset-gate.mjs = agent preset 资产包形态判定与门禁豁免判据，issue #231；
// deps-matrix.mjs = 依赖矩阵的版本解析/分档/漂移判定，issue #184；
// fork-pool.mjs = fork 池的参数解析/路径推导/基线判定/清理护栏，issue #240；
// ship-pipeline.mjs = 提交流水线的 fail-closed 判据/步骤清单/结果渲染，issue #240；
// release-timing.mjs = 发版阶段耗时表，issue #246；
// release-concurrency.mjs = 发版有界并发调度，issue #246；
// release-tag-push.mjs = tag 逐个推送与触发确认（一次推 N 个 tag = 零触发的根因），issue #375-#380；
// pack-hygiene.mjs = 包发布卫生判定（字段自洽 / pack 内容 / README 引用面），issue #323；
// verify-checklist.mjs = 验证清单的渲染/幂等合并/#67 门禁判定，issue #329；
// test-sleeps.mjs = 测试里固定 sleep 的分类/豁免/基线判定，issue #335；
// verify-checklist.mjs = 验证清单的渲染/幂等合并/#67 门禁判定，issue #329；
// pack-hygiene.mjs = 包发布卫生判定（字段自洽 / pack 内容 / README 引用面），issue #323；
// gate-registry.mjs = 门禁登记表（检查项 → 唯一权威执行点），issue #330；
// ci-workflow.mjs = ci.yml 极简解析（job/steps/run），issue #330；
// gitleaks-scan.mjs = secret 扫描门禁判据（平台/校验值/版本/报告净化/fail-closed），issue #324；
// commit-lint.mjs = 提交信息门禁判据（范围推导/空范围 fail-closed/渲染），issue #324），
// npm-registry.mjs = 发版门禁 1a/1c 的 npm 查询钉官方源与判定（假绿/假红），issue #386，
// verify-timeout.mjs = verify-local 超时配置解析（fail-closed：0 / 负数 / 空 / 非法一律报错，none 才是显式关闭），
// verify-credentials.mjs = 隔离实例凭据 refs 解析 / provider 段按需继承 / 启动前自检 / 真实调用探针判定（issue #403），
// 阈值与根配置一致（行 85 / 分支 75 / 函数 80）。
//
// 为什么放宽 testTimeout/hookTimeout 到 60s（issue #353）：本目录大量用例 spawn 真实 CLI
// （git / node / commitlint / gitleaks / 重建 client bundle），低负载 0.3~0.7s、多 agent 并行
// 下 6~17s，撞 vitest 默认 5s 上限即假红。放宽的是**框架停机保护（允许慢）**，不是判据
// （绝不允许用调大阈值换绿）——见 docs/踩坑/异步落盘与时序.md。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/test/*.test.mjs'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: [
        'scripts/lib/release-checks.mjs',
        'scripts/lib/npm-audit.mjs',
        'scripts/lib/verify-profile.mjs',
        'scripts/lib/screenshot-gate.mjs',
        'scripts/lib/preset-gate.mjs',
        'scripts/lib/deps-matrix.mjs',
        'scripts/lib/fork-pool.mjs',
        'scripts/lib/ship-pipeline.mjs',
        'scripts/lib/release-timing.mjs',
        'scripts/lib/release-concurrency.mjs',
        'scripts/lib/release-tag-push.mjs',
        'scripts/lib/pack-hygiene.mjs',
        'scripts/lib/verify-checklist.mjs',
        'scripts/lib/test-sleeps.mjs',
        'scripts/lib/gate-registry.mjs',
        'scripts/lib/ci-workflow.mjs',
        'scripts/lib/gitleaks-scan.mjs',
        'scripts/lib/commit-lint.mjs',
        'scripts/lib/npm-registry.mjs',
        'scripts/lib/verify-timeout.mjs',
        'scripts/lib/verify-credentials.mjs',
      ],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 80,
      },
    },
  },
})

#!/usr/bin/env bash
# 遍历全部 TS 插件：server 端 + client 端类型检查。
#
# 为什么需要本脚本：根 tsconfig.json 的 include 覆盖 plugins/**，但必须
# exclude plugins/*/src/client/**——client parts 是"拼接片段"（无 import/
# export，靠 factory 全局作用域共享符号），在根配置的 nodenext 模块模式下
# 每个片段被当成独立模块，跨文件符号全部解析失败（数百个 TS2304/TS2552）。
# 因此 client 端的类型检查由各插件自己的 tsconfig.client.json 承担（该配置
# 用 module: commonjs，无 import/export 的文件是全局脚本，语义与拼接一致），
# 本脚本在 CI 中统一执行，避免"排除了但没人检查"的盲区。
#
# 与 .github/workflows/ci.yml 的 quality job 保持一致。
set -e
checked=0
for d in plugins/*/; do
  [ -f "$d/tsconfig.json" ] || continue
  echo "== $d server =="
  (cd "$d" && npx tsc --noEmit -p tsconfig.json)
  checked=$((checked + 1))
  if [ -f "$d/tsconfig.client.json" ]; then
    echo "== $d client =="
    (cd "$d" && npx tsc --noEmit -p tsconfig.client.json)
  fi
done
echo "ALL PLUGIN TYPE CHECKS PASSED ($checked plugins)"

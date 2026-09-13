#!/bin/bash
# 测试插件加载状态

set -e

DSH_PORT=3087
DSH_URL="http://127.0.0.1:$DSH_PORT"

echo "=== 测试插件加载状态 ==="
echo "DSH 地址: $DSH_URL"
echo ""

# 检查 DSH 是否运行
if ! curl -s "$DSH_URL" > /dev/null; then
    echo "❌ DSH 服务未运行或无法访问"
    exit 1
fi

echo "✅ DSH 服务正在运行"
echo ""

# 测试各个插件的 API 端点
echo "测试插件 API 端点:"
echo ""

# 测试文件活动插件
echo "1. 文件活动插件 (dsh-file-activity):"
if curl -s "$DSH_URL/file-activity/api/stats?sessionId=test" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试 Markdown 渲染插件
echo "2. Markdown 渲染插件 (dsh-md-render):"
if curl -s "$DSH_URL/md-render/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试上下文管理插件
echo "3. 上下文管理插件 (dsh-my-context):"
if curl -s "$DSH_URL/context/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试远程连接插件
echo "4. 远程连接插件 (dsh-my-remote):"
if curl -s "$DSH_URL/remote/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试任务可靠性插件
echo "5. 任务可靠性插件 (dsh-task-reliability):"
if curl -s "$DSH_URL/task-reliability/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试技能管理插件
echo "6. 技能管理插件 (dsh-my-skill-manager):"
if curl -s "$DSH_URL/skill-manager/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试插件管理插件
echo "7. 插件管理插件 (dsh-my-plugin-manager):"
if curl -s "$DSH_URL/plugin-manager/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试通知插件
echo "8. 通知插件 (dsh-my-notify):"
if curl -s "$DSH_URL/notify/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试可观测性插件
echo "9. 可观测性插件 (dsh-my-observability):"
if curl -s "$DSH_URL/observability/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

# 测试守护插件
echo "10. 守护插件 (dsh-my-guardian):"
if curl -s "$DSH_URL/guardian/api/health" | grep -q "ok"; then
    echo "   ✅ API 端点正常"
else
    echo "   ❌ API 端点异常"
fi

echo ""
echo "=== 测试完成 ==="
echo ""
echo "如果所有插件都显示 ✅，说明插件加载正常"
echo "如果有插件显示 ❌，请检查插件日志"
echo ""
echo "查看插件日志:"
echo "  1. 在浏览器中打开开发者工具 (F12)"
echo "  2. 查看 Console 标签页的日志"
echo "  3. 检查是否有插件加载错误"
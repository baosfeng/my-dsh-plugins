#!/bin/bash
# 测试 DSH 插件加载

echo "=== 测试 DSH 插件加载 ==="
echo ""

# 检查 DSH 进程
echo "1. 检查 DSH 进程:"
ps aux | grep "dsh web" | grep -v grep
echo ""

# 检查端口监听
echo "2. 检查端口监听:"
netstat -an | grep 3087
echo ""

# 检查配置文件
echo "3. 检查配置文件:"
cd /Users/bsfeng/.dsh/profiles/default
echo "package.json 中的依赖数量:"
grep -c '"file:' package.json
echo ""

# 检查 node_modules 链接
echo "4. 检查 node_modules 链接:"
ls -la node_modules/ | grep "^l" | wc -l
echo "个插件链接"
echo ""

# 测试插件 API（使用正确的端点）
echo "5. 测试插件 API:"
echo "   文件活动插件:"
curl -s "http://127.0.0.1:3087/file-activity/api/stats?sessionId=test" | head -c 100
echo ""
echo ""

echo "   远程连接插件:"
curl -s "http://127.0.0.1:3087/remote/api/health" | head -c 100
echo ""
echo ""

echo "   通知插件:"
curl -s "http://127.0.0.1:3087/notify/api/health" | head -c 100
echo ""
echo ""

# 检查 DSH 配置
echo "6. 检查 DSH 配置:"
dsh --profile default --dump-config 2>&1 | head -20
echo ""

echo "=== 测试完成 ==="
echo ""
echo "如果插件 API 返回数据，说明插件加载正常"
echo "如果返回空或错误，说明插件可能未正确加载"
echo ""
echo "建议:"
echo "1. 在浏览器中访问 http://127.0.0.1:3087"
echo "2. 查看侧边栏是否有插件页面"
echo "3. 在开发者工具中查看控制台日志"
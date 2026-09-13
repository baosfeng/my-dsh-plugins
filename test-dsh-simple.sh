#!/bin/bash
# 简单测试 DSH 插件启动

set -e

DSH_PROFILE_DIR="/Users/bsfeng/.dsh/profiles/default"
TEST_PORT=3087

echo "=== 测试 DSH 插件启动 ==="
echo "测试端口: $TEST_PORT"
echo ""

# 检查当前是否有 DSH 进程在运行
if pgrep -f "dsh web" > /dev/null; then
    echo "警告: 检测到 DSH 进程已在运行"
    echo "当前进程:"
    ps aux | grep "dsh web" | grep -v grep
    echo ""
    echo "请先停止当前进程: pkill -f 'dsh web'"
    echo "或者使用其他端口"
    exit 1
fi

echo "正在启动 DSH 测试实例..."
echo "端口: $TEST_PORT"
echo ""

# 启动 DSH（使用默认配置）
dsh web --port "$TEST_PORT" --no-open 2>&1 &
DSH_PID=$!

echo "DSH 进程已启动 (PID: $DSH_PID)"
echo "等待服务启动..."
sleep 10

# 检查服务是否启动
if kill -0 "$DSH_PID" 2>/dev/null; then
    echo "✅ DSH 服务已启动"
    echo ""
    echo "访问地址: http://127.0.0.1:$TEST_PORT"
    echo ""
    echo "测试步骤:"
    echo "1. 在浏览器中访问上述地址"
    echo "2. 检查侧边栏是否有插件页面"
    echo "3. 测试各个插件的功能"
    echo ""
    echo "按 Ctrl+C 停止测试"
    
    # 等待用户中断
    trap "echo ''; echo '正在停止 DSH...'; kill $DSH_PID 2>/dev/null; exit 0" INT
    wait $DSH_PID
else
    echo "❌ DSH 服务启动失败"
    exit 1
fi
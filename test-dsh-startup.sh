#!/bin/bash
# 临时启动 DSH 测试插件

set -e

DSH_PROFILE_DIR="/Users/bsfeng/.dsh/profiles/default"
TEST_PORT=3087
TEST_DIR="/tmp/dsh-test-$(date +%s)"

echo "=== 临时启动 DSH 测试插件 ==="
echo "测试端口: $TEST_PORT"
echo "测试目录: $TEST_DIR"
echo ""

# 创建测试目录
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# 复制配置文件
cp "$DSH_PROFILE_DIR/package.json" .
cp "$DSH_PROFILE_DIR/cordis.patch.yml" .

# 创建临时的 settings.yaml
cat > settings.yaml << 'EOF'
# 临时测试配置
ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
ui-theme:
  preference: light
permission:
  defaultPreset: danger-full-access
ui-chat:
  transcriptView: normal
agent-default-model:
  provider: xiaomi-token-plan-cn
  model: mimo-v2.5-pro
llm-pi-ai:
  providers:
    xiaomi-token-plan-cn:
      apiKeyEnv: XIAOMI_TOKEN_PLAN_CN_API_KEY
llm-deepseek:
  models:
    - id: deepseek-flash
      name: DeepSeek-V41-Flash
      contextWindow: 1000000
      inputModalities:
        - text
        - image
      imagePixelBudget: 640000
      imageMaxBytes: 1048576
      systemPromptUpdate: in-history
agent-presets:
  default: standard
EOF

# 创建临时的 .dsh 目录
mkdir -p .dsh

# 复制凭证文件（如果存在）
if [ -f "/Users/bsfeng/.dsh/.credentials.yaml" ]; then
    cp "/Users/bsfeng/.dsh/.credentials.yaml" .dsh/
fi

if [ -f "/Users/bsfeng/.dsh/.anonymous-user-id" ]; then
    cp "/Users/bsfeng/.dsh/.anonymous-user-id" .dsh/
fi

# 复制 secrets 目录（如果存在）
if [ -d "/Users/bsfeng/.dsh/secrets" ]; then
    cp -r "/Users/bsfeng/.dsh/secrets" .dsh/
fi

# 复制 llm-deepseek 目录（如果存在）
if [ -d "/Users/bsfeng/.dsh/llm-deepseek" ]; then
    cp -r "/Users/bsfeng/.dsh/llm-deepseek" .dsh/
fi

echo "正在启动 DSH 测试实例..."
echo "端口: $TEST_PORT"
echo ""

# 启动 DSH
DSH_HOME="$TEST_DIR/.dsh" dsh web --port "$TEST_PORT" --profile "$DSH_PROFILE_DIR" 2>&1 &
DSH_PID=$!

echo "DSH 进程已启动 (PID: $DSH_PID)"
echo "等待服务启动..."
sleep 5

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
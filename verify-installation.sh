#!/bin/bash
# 验证插件安装是否成功

DSH_PROFILE_DIR="/Users/bsfeng/.dsh/profiles/default"
REPO_DIR="/Users/bsfeng/IdeaProjects/my-dsh-plugins"

echo "=== 验证插件安装状态 ==="
echo ""

# 检查 node_modules 是否存在
if [ ! -d "$DSH_PROFILE_DIR/node_modules" ]; then
    echo "错误: node_modules 目录不存在"
    exit 1
fi

# 检查每个插件是否正确链接
echo "检查插件链接状态:"
success=0
failed=0

for dir in "$REPO_DIR/plugins"/*/; do
    if [ -f "$dir/package.json" ]; then
        name=$(cat "$dir/package.json" | grep '"name"' | head -1 | sed 's/.*"name": "\(.*\)".*/\1/')
        
        if [ -L "$DSH_PROFILE_DIR/node_modules/$name" ]; then
            target=$(readlink "$DSH_PROFILE_DIR/node_modules/$name")
            if [ "$target" = "../../../../IdeaProjects/my-dsh-plugins/plugins/$name" ]; then
                echo "  ✅ $name: 正确链接"
                ((success++))
            else
                echo "  ❌ $name: 链接目标错误 ($target)"
                ((failed++))
            fi
        else
            echo "  ❌ $name: 未找到链接"
            ((failed++))
        fi
    fi
done

echo ""
echo "=== 验证结果 ==="
echo "成功: $success 个插件"
echo "失败: $failed 个插件"

if [ $failed -eq 0 ]; then
    echo ""
    echo "✅ 所有插件安装成功！"
    echo ""
    echo "下一步:"
    echo "  1. 重启 DSH 以加载新插件: dsh web"
    echo "  2. 在浏览器中访问 DSH，检查插件是否正常加载"
else
    echo ""
    echo "❌ 部分插件安装失败，请检查错误信息"
    exit 1
fi
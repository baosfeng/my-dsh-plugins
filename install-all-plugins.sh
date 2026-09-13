#!/bin/bash
# 安装所有插件到 DSH 的脚本

set -e

DSH_PROFILE_DIR="/Users/bsfeng/.dsh/profiles/default"
REPO_DIR="/Users/bsfeng/IdeaProjects/my-dsh-plugins"

echo "=== 开始安装所有插件到 DSH ==="
echo "DSH 配置目录: $DSH_PROFILE_DIR"
echo "插件仓库目录: $REPO_DIR"
echo ""

# 检查 DSH 配置目录是否存在
if [ ! -d "$DSH_PROFILE_DIR" ]; then
    echo "错误: DSH 配置目录不存在: $DSH_PROFILE_DIR"
    exit 1
fi

# 备份原始 package.json
cp "$DSH_PROFILE_DIR/package.json" "$DSH_PROFILE_DIR/package.json.backup-$(date +%Y%m%d-%H%M%S)"
echo "已备份原始 package.json"

# 获取所有插件名称
echo "正在获取所有插件信息..."
plugins=()
while IFS= read -r dir; do
    if [ -f "$dir/package.json" ]; then
        name=$(cat "$dir/package.json" | grep '"name"' | head -1 | sed 's/.*"name": "\(.*\)".*/\1/')
        version=$(cat "$dir/package.json" | grep '"version"' | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
        plugins+=("$name:$version")
        echo "  - $name ($version)"
    fi
done < <(find "$REPO_DIR/plugins" -maxdepth 1 -mindepth 1 -type d)

echo ""
echo "找到 ${#plugins[@]} 个插件"

# 创建新的 package.json
echo "正在生成新的 package.json..."
cat > "$DSH_PROFILE_DIR/package.json" << 'EOF'
{
  "name": "dsh-profile-default",
  "private": true,
  "dependencies": {
EOF

# 添加所有插件依赖
first=true
for plugin in "${plugins[@]}"; do
    name="${plugin%%:*}"
    version="${plugin##*:}"
    
    if [ "$first" = true ]; then
        first=false
    else
        echo "    ," >> "$DSH_PROFILE_DIR/package.json"
    fi
    
    # 使用本地路径引用
    echo "    \"$name\": \"file:$REPO_DIR/plugins/$name\"" >> "$DSH_PROFILE_DIR/package.json"
done

cat >> "$DSH_PROFILE_DIR/package.json" << 'EOF'
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base"
      ],
      "patchReload": "live"
    }
  }
}
EOF

echo "已生成新的 package.json"
echo ""

# 显示生成的 package.json
echo "生成的 package.json 内容:"
cat "$DSH_PROFILE_DIR/package.json"
echo ""

# 安装依赖
echo "正在安装依赖..."
cd "$DSH_PROFILE_DIR"

# 清理 node_modules
if [ -d "node_modules" ]; then
    echo "清理旧的 node_modules..."
    rm -rf node_modules
fi

# 安装依赖
echo "运行 npm install..."
npm install

echo ""
echo "=== 安装完成 ==="
echo "已安装 ${#plugins[@]} 个插件到 DSH"
echo ""
echo "请重启 DSH 以加载新插件:"
echo "  dsh web"
---
name: plugin-runtime-debug
description: 使用当 已安装的 DSH Web 插件只在浏览器运行时行为异常——粘贴/附件/合成器功能第一次成功后续失败、chips/面板显示陈旧占位状态、更新芯片报错版本——且修复必须对照精确宿主 API 语义诊断而非按名字猜测时。也用于发版前审查插件对 input-machine/facade verb（insert/consume/remove/subscribe）的调用。
---

# 调试 DSH Web 插件运行时行为（plugin-runtime-debug）

外部 Web 插件调用宿主 client API，其契约在 DSH 源码树里，不在插件自己的类型里。运行时行为偏离意图时，失败几乎总是契约误读——诊断必须来自宿主源码，绝不来自 API 名字。

## 铁律：先在宿主源码里读 verb 的契约

改任何宿主 API 调用前，打开 DSH 源码检出（`~/.dsh/source/current` 或 vendored 副本）里实现该 API 的包，读实际方法——doc 注释、guards、比较的类型。对插件传入的每个值重复。三个问题覆盖多数事故：

1. **offset 数的是哪个字符串？** verb 接受 span/offset 时，弄清这些数字索引的是什么字符串。发布快照字段与内部编辑器投影不总是同一个字符串；把一种表示的 offset 喂给 guard 比较另一种表示的 verb，会静默失败（返回 `false` 或 no-op，不抛错）。
2. **每个"单位"在各表示中占多宽？** 文档含不透明内联单位（chips/tokens/attachments）时，检查单位在发布字段与 verb guard 的投影中是否同宽。宽度不同时，offset 只在无单位时正确——"第一次成功、之后每次失败"就是信号。
3. **verb 拒绝时谁发现？** 布尔返回的 verb 静默失败会变成下游状态 bug：调用方照删自己的簿记，UI 在从未消失的对象旁渲染"缺失/不可用"占位。审计每个调用点的"fire, ignore result, clean up state anyway"形态。

## 症状族与指向

- **第一次交互成功、之后每次报错**——前次调用写入的状态改变了插件计算与 verb 预期之间的映射。比较一次插入前后的两种表示；从宿主源码的单位宽度推导修正，并应用到**每个**传 offset 的调用点，不只崩溃那个。
- **删除按钮留下行 + 占位标签**——删除 verb 拒绝（见问题 3）而簿记已丢。用 verb 返回值确认，只在删除真正生效后退役簿记。
- **派生 UI 显示陈旧/幻影条目**——找到事实的权威源并从它派生视图。带订阅的插件侧缓存会在任何瞬时快照（reconcile/remount 的空档）退役活条目；优先在决策时读实时发布状态，缓存只当加速器。
- **更新/版本芯片报错"latest"**——远程 tag 与 raw-file 端点被 CDN 缓存，滞后真实推送数分钟。绝不把取回的远程值当真相（可能比运行构建旧）；用运行版本判定"当前 vs 更新"，显示两者中较新者。
- **发布后整个 slot 的 UI 静默消失**——slot 组件内 throw（典型：悬空标识符——越作用域引用另一组件的状态变量）被框架的 slot 级错误边界捕获并卸载整个 entry；错误只在 console，用户只报"chips/面板没了"。两个延迟机制藏住它：`||` 短路让表达式在左操作数为 false 前不求值；空状态早退的组件在真实数据渲染前不求值。不要默认怪最新 diff——按回滚或带数据的最小渲染挂载二分，检查抛错行是否更早发布，修复=移除引用（状态局部化）。slot 组件加固：防御性读取（`x?.items ?? []`）与可选链 DOM 访问（`target.closest?.()`）——错误边界内任何 throw 都赔掉整个 slot。
- **仓库改动到不了 GUI / profile 的 node_modules 下 EBUSY**——先确定安装模式（`Get-Item <profile>/node_modules/<pkg> | Select LinkType, Target`，或 cordis.patch.yml 的 `link:<path>` 标记）。Junction/link 安装 = 仓库工作树就是已装副本，无需复制步骤；EBUSY 持有者是运行中的 dsh 宿主进程（关浏览器不释放），宿主重启后浏览器仍可能服务缓存的 client bundle。link 安装的 lib-only 插件激活：完全停宿主 → 重启 `dsh web` → 硬刷新 → 核验加载的版本标记。绝不在未解析路径下 rename-aside 文件：junction 下"两个"目录是一个，rename 会移走唯一副本。

## 工作流

1. 复现一次并捕获精确用户可见字符串（toast 文本、chip 标签、console 输出）——它们是 bug 报告的契约。
2. 把每个字符串映射到发出它的代码路径；识别边界的宿主 verb。
3. 打开该 verb 的宿主源码；回答三个铁律问题。
4. 写任何修复前精确陈述不匹配（哪个表示/哪个 guard/哪些调用点）；说不清就是源码读得不够。
5. 修**所有**传表示相关值的调用点，不只报告的症状——同一不匹配通常经两个不同 verb 破坏两个功能。
6. 用失败的交互序列证明修复：连续两次操作断言两次行为一致；断言删除路径清空对象的每个视图。
7. lib-only 插件 bundle（无构建步骤）：手内联版本常量与 `package.json` 保持同步，bundle 过 `node --check`，硬刷新后浏览器验证——服务的产物就是你编辑的文件。

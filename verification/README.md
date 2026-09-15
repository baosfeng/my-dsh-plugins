---
title: 发版验证清单
description: 本目录只放发版门禁按需生成的清单，不保留历史记录
---

# 发版验证清单

> ⚠️ **何时阅读：** 发版需要功能级验证清单时。

本目录**不保留历史清单**。清单是 `scripts/release.mjs` 3c 步骤的产物兼门禁输入：随发版 commit 生成、勾选、提交；下次发版生成新文件，旧文件即可删除（历史留痕看 git 与 GitHub Release）。

| 目的       | 命令                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 生成并勾选 | `node scripts/verify-real-profile.mjs --addons plugins/<插件> --checklist verification/<插件>-<版本>.md --plugin <插件>` |
| 校验       | `node scripts/verify-real-profile.mjs --check verification/<插件>-<版本>.md`                                             |

- 已存在的清单按**幂等合并**处理：人工「验证记录」段与已勾选 `[x]` 逐字节保留，只刷新自动项。
- 功能级项须在隔离实例 + 真实浏览器/真实模型下验证，未全勾选即阻断发版。
- 执行手册见 `skills/verifying-dsh-plugins/`（含验证后清理环境，防残留污染）。

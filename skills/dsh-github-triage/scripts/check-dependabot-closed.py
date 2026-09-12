#!/usr/bin/env python3
"""Dependabot 已关闭告警巡检（issue #214）。

为什么需要它：GitHub 对 npm development scope 的传递依赖告警有 on-by-default 的
auto-dismiss（见 docs/踩坑/dependabot自动关闭告警造成安全假阴性.md）。这类告警
不出现在默认的 open 列表里，只看 open 会把「报了但被自动关闭」误判成「根本没报」。
更糟的是：等依赖升级到修复版本后，GitHub 会把 state 从 auto_dismissed 改成 fixed 并
**清空 auto_dismissed_at / dismissed_reason**，自动关闭这段历史会彻底消失——所以
「现在查不到 auto_dismissed」不等于「没发生过」。

本脚本列出**全部已关闭**的 Dependabot 告警（fixed / dismissed / auto_dismissed），
并逐个核对对应依赖是否**仍以受影响版本存在于 lockfile 中**，把需要人看的挑出来。

用法（只读，不改任何东西）：

    # 推荐：一条命令打印「已关闭告警 + 依赖是否仍在 lockfile 中」
    cd <repo>
    bash <本脚本目录>/check-dependabot-closed.sh

    # 等价手工两步：
    ghops alerts <owner/repo> --state closed --kind dependabot --json > /tmp/closed.json
    python3 check-dependabot-closed.py /tmp/closed.json --repo-dir .

    # 或直接管道：JSON 从 stdin 读入
    ghops alerts <owner/repo> --state closed --kind dependabot --json | python3 check-dependabot-closed.py -

退出码：0 = 没有「仍受影响」的已关闭告警；1 = 有（需人工判读，可能是误关）；2 = 用法/环境错误。
"""

import argparse
import json
import os
import re
import subprocess
import sys

CLOSED_STATES = ("fixed", "dismissed", "auto_dismissed", "resolved")

# ---------- 版本比较（够用即可：只解析 npm 常见范围写法，不引外部依赖） ----------


def _parse_version(text):
    """'6.15.3' / 'v6.15.3' / '6.15.3-beta.1' → (6, 15, 3, ('beta', 1))"""
    text = str(text or "").strip().lstrip("vV")
    m = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+]?(.*))?$", text)
    if not m:
        return None
    major = int(m.group(1))
    minor = int(m.group(2) or 0)
    patch = int(m.group(3) or 0)
    pre = m.group(4) or ""
    return (major, minor, patch, pre)


def _cmp(a, b):
    for x, y in zip(a[:3], b[:3]):
        if x != y:
            return -1 if x < y else 1
    pa, pb = a[3], b[3]
    if pa == pb:
        return 0
    if not pa:  # 正式版 > 预发布版
        return 1
    if not pb:
        return -1
    return -1 if pa < pb else 1


def _cmp_op(version, raw_op, raw_number):
    target = _parse_version(raw_number)
    if target is None or version is None:
        return None
    c = _cmp(version, target)
    op = raw_op or "="
    return {
        ">": c > 0,
        ">=": c >= 0,
        "<": c < 0,
        "<=": c <= 0,
        "=": c == 0,
        "==": c == 0,
    }.get(op)


def version_in_range(version, version_range):
    """解析诸如 '>= 6.14.2, <= 6.15.3' / '>= 2.2.5, < 6.16.0' / '< 6.16.0' / '^1.2.3'。

    返回 True/False；无法解析时返回 None（判定为「不确定」，交由人工判读）。
    """
    version = _parse_version(version)
    if version is None:
        return None
    text = str(version_range or "").strip()
    if not text:
        return None

    for clause_group in text.split("||"):
        clause_group = clause_group.strip()
        if not clause_group:
            continue
        results = []
        for clause in re.split(r"\s*,\s*|\s+(?=[<>=^~])", clause_group):
            clause = clause.strip()
            if not clause:
                continue
            m = re.match(r"^(>=|<=|>|<|=|==|\^|~)?\s*v?([0-9][0-9A-Za-z.\-+]*)$", clause)
            if not m:
                results = None
                break
            op, number = m.group(1), m.group(2)
            if op in ("^", "~"):
                base = _parse_version(number)
                if base is None:
                    results = None
                    break
                upper = (
                    (base[0] + 1, 0, 0, "") if op == "^" and base[0] > 0
                    else (0, base[1] + 1, 0, "") if op == "^"
                    else (base[0], base[1] + 1, 0, "")
                )
                results.append(_cmp(version, base) >= 0 and _cmp(version, upper) < 0)
            else:
                r = _cmp_op(version, op, number)
                if r is None:
                    results = None
                    break
                results.append(r)
        if results and all(results):
            return True
    return False


# ---------- lockfile 扫描（只读） ----------

SKIP_DIRS = {"node_modules", ".git", ".venv", "dist", "build", "coverage", "vendor"}
LOCK_NAMES = ("package-lock.json", "npm-shrinkwrap.json")


def iter_lockfiles(repo_dir):
    for root, dirs, files in os.walk(repo_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if name in LOCK_NAMES:
                yield os.path.join(root, name)


def load_dep_tree(lockfile_path):
    """返回 (name → [version...], name → [依赖它的父包...])（只含目录树里能定位到版本的包）。"""
    try:
        with open(lockfile_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001 - 巡检脚本：读不动就跳过并说明
        return {}, {}, "无法解析：%s" % exc

    versions = {}
    parents = {}
    packages = data.get("packages")
    if isinstance(packages, dict) and packages:
        for path, meta in packages.items():
            if not isinstance(meta, dict) or "version" not in meta:
                continue
            name = meta.get("name") or (path.split("node_modules/")[-1] if "node_modules/" in path else path)
            if not name:
                continue
            versions.setdefault(name, []).append(str(meta["version"]))
            for dep_name in (meta.get("dependencies") or {}):
                parents.setdefault(dep_name, []).append(name)
    else:  # lockfileVersion 1 的兜底
        for name, meta in (data.get("dependencies") or {}).items():
            if isinstance(meta, dict) and meta.get("version"):
                versions.setdefault(name, []).append(str(meta["version"]))

    # 去重且保持稳定顺序
    for name in list(versions):
        versions[name] = sorted(set(versions[name]))
    for name in list(parents):
        parents[name] = sorted(set(parents[name]))
    return versions, parents, None


def inspect_dependency(repo_dir, manifest_path, package_name):
    """核对某个包在 lockfile 里的现状。

    返回 dict：in_lockfile / versions / dev_only / parents / note
    """
    result = {
        "in_lockfile": False,
        "versions": [],
        "dev_only": False,
        "parents": [],
        "deeper_lockfiles": [],
        "note": "",
    }
    targets = []
    candidates = []
    if manifest_path:
        candidate = os.path.normpath(os.path.join(repo_dir, manifest_path))
        if os.path.isfile(candidate):
            candidates.append(candidate)
    if not candidates:
        candidates = sorted(iter_lockfiles(repo_dir))
    for path in candidates:
        versions, parents, err = load_dep_tree(path)
        rel = os.path.relpath(path, repo_dir)
        if err:
            result["note"] = "%s %s" % (rel, err)
            continue
        if package_name in versions:
            targets.append((rel, versions[package_name], parents.get(package_name, [])))
        else:
            result["deeper_lockfiles"].append(rel)

    if not targets:
        result["note"] = result["note"] or "lockfile 中已无该包（可能已移除或已换依赖树）"
        return result

    result["in_lockfile"] = True
    for rel, versions, parents in targets:
        result["versions"].extend(versions)
        result["parents"].extend(parents)
        result["lockfile"] = rel
        result["manifest_checked"] = rel
        try:
            with open(os.path.join(repo_dir, rel), "r", encoding="utf-8") as fh:
                raw = json.load(fh)
            packages = (raw.get("packages") or {})
            for path, meta in packages.items():
                if path.endswith("node_modules/" + package_name) and isinstance(meta, dict):
                    if meta.get("dev"):
                        result["dev_only"] = True
        except Exception:  # noqa: BLE001
            pass
    result["versions"] = sorted(set(result["versions"]))
    result["parents"] = sorted(set(result["parents"]))[:6]
    return result


# ---------- 主流程 ----------


def read_payload(source):
    if source in (None, "-"):
        text = sys.stdin.read()
    elif os.path.isfile(source):
        with open(source, "r", encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = source
    text = text.strip()
    if not text:
        raise SystemExit("！没有拿到任何 JSON 输入。请先执行：ghops alerts <owner/repo> --state closed --kind dependabot --json > /tmp/closed.json")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SystemExit("！输入不是合法 JSON（%s）。多半是 ghops 报错信息混进了输出，先单独跑一次 ghops 看提示。" % exc)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("dependabot") or []
    raise SystemExit("！无法识别的 JSON 结构：%s" % type(data).__name__)


def alert_state(alert):
    state = (alert.get("state") or "").strip()
    return state or "unknown"


def main(argv=None):
    parser = argparse.ArgumentParser(description="列出已关闭的 Dependabot 告警并核对依赖是否仍在 lockfile 中")
    parser.add_argument("source", nargs="?", default="-", help="ghops alerts --json 的输出文件，或 - 表示从 stdin 读")
    parser.add_argument("--repo-dir", default=".", help="仓库本地目录（默认当前目录）")
    parser.add_argument("--all-states", action="store_true", help="连 open 告警一起列（默认只看已关闭）")
    args = parser.parse_args(argv)

    repo_dir = os.path.abspath(args.repo_dir)
    alerts = read_payload(args.source)

    closed = [a for a in alerts if args.all_states or alert_state(a) in CLOSED_STATES]
    closed.sort(key=lambda a: a.get("number") or 0)

    print("=" * 78)
    print("Dependabot 已关闭告警巡检  (issue #214)")
    print("仓库目录：%s" % repo_dir)
    print("已关闭告警：%d 条" % len(closed))
    print("=" * 78)

    if not closed:
        print("没有已关闭的 Dependabot 告警。注意：这**不能**单独证明「从来没报过」——")
        print("若某个已知漏洞的修复版本是最近才升上去的，历史 auto_dismissed 记录可能已被")
        print("state=fixed 覆盖（自动关闭时间戳会被清空），需查 alert 详情页 timeline。")
        return 0

    still_affected = []
    needs_review = []
    for alert in closed:
        number = alert.get("number")
        state = alert_state(alert)
        dependency = alert.get("dependency") or {}
        package_name = ((dependency.get("package") or {}).get("name")) or "?"
        manifest = dependency.get("manifest_path") or ""
        scope = dependency.get("scope") or "?"
        relationship = dependency.get("relationship") or "?"
        advisory = alert.get("security_advisory") or {}
        vulnerability = alert.get("security_vulnerability") or {}
        vulnerable_range = vulnerability.get("vulnerable_version_range") or ""
        patched = ((vulnerability.get("first_patched_version") or {}) or {}).get("identifier") or "（无修复版本）"

        info = inspect_dependency(repo_dir, manifest, package_name)
        verdict = "?"
        detail = ""
        if not info["in_lockfile"]:
            verdict = "✔ 已不在依赖树"
            detail = info["note"] or ""
        else:
            hits = [v for v in info["versions"] if version_in_range(v, vulnerable_range) is True]
            unknown = [v for v in info["versions"] if version_in_range(v, vulnerable_range) is None]
            if hits:
                verdict = "⚠ 仍受影响"
                detail = "lockfile 中 %s，落在 %s 内" % (", ".join(hits), vulnerable_range or "?")
            elif unknown and len(unknown) == len(info["versions"]):
                verdict = "？ 版本已变，范围无法自动比对"
                detail = "lockfile 中 %s；请人工对照 %s" % (", ".join(info["versions"]), vulnerable_range or "?")
            else:
                verdict = "✔ 已升到修复版"
                detail = "lockfile 中 %s，不在 %s 内" % (", ".join(info["versions"]), vulnerable_range or "?")

        if info["parents"]:
            detail += "；由 %s 引入" % ", ".join(info["parents"][:3])

        row = {
            "number": number,
            "state": state,
            "package": package_name,
            "scope": scope,
            "relationship": relationship,
            "severity": advisory.get("severity") or vulnerability.get("severity") or "?",
            "summary": advisory.get("summary") or "",
            "html_url": alert.get("html_url") or "",
            "verdict": verdict,
            "detail": detail,
            "created_at": alert.get("created_at") or "",
            "closed_at": alert.get("fixed_at") or alert.get("dismissed_at") or alert.get("auto_dismissed_at") or "",
            "auto_dismissed_at": alert.get("auto_dismissed_at") or "",
            "dismissed_by": (alert.get("dismissed_by") or {}).get("login") if isinstance(alert.get("dismissed_by"), dict) else (alert.get("dismissed_by") or ""),
            "dismissed_reason": alert.get("dismissed_reason") or "",
            "patched": patched,
        }
        if verdict.startswith("⚠"):
            still_affected.append(row)
        elif verdict.startswith("？"):
            needs_review.append(row)
        else:
            pass
        print("")
        print("#%s  [%s]  %s  %s" % (number, state, row["severity"], package_name))
        print("    摘要      : %s" % row["summary"])
        print("    依赖       : scope=%s relationship=%s manifest=%s" % (scope, relationship, manifest or "(空)"))
        print("    受影响范围 : %s    修复版本: %s" % (vulnerable_range or "?", patched))
        print("    时间       : created=%s closed=%s auto_dismissed=%s" % (row["created_at"], row["closed_at"], row["auto_dismissed_at"] or "（已被清空）"))
        print("    关闭者     : %s / %s" % (row["dismissed_by"] or "（空=非人工）", row["dismissed_reason"] or "（空）"))
        print("    本地核对   : %s  %s" % (verdict, detail))
        print("    链接       : %s" % row["html_url"])

    print("")
    print("-" * 78)
    if still_affected:
        print("⚠ 需人工判读：%d 条已关闭告警的依赖仍以受影响版本存在于 lockfile ——" % len(still_affected))
        for row in still_affected:
            print("   #%s %s (%s) → %s" % (row["number"], row["package"], row["state"], row["html_url"]))
        print("   处理：确认是否误关（auto_dismissed 会误判 development 传递依赖）；仍受影响就升级依赖并复查。")
    if needs_review:
        print("？ 需人工对照：%d 条无法自动比对版本范围（脚本不理解的 range 写法或版本已变）。" % len(needs_review))
    if not still_affected and not needs_review:
        print("✔ 全部已关闭告警的依赖都已脱离受影响范围（或已从依赖树移除）。")

    print("")
    print("提示：GitHub 在依赖升到修复版后会把 state 从 auto_dismissed 改成 fixed 并清空")
    print("      auto_dismissed_at —— 自动关闭的**历史**只留存在 alert 详情页 timeline。")
    print("      因此「现在查不到 auto_dismissed」不能证明「从来没被自动关闭过」。")
    return 1 if still_affected else 0


if __name__ == "__main__":
    sys.exit(main())

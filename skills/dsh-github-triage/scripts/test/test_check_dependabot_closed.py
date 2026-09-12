#!/usr/bin/env python3
"""check-dependabot-closed.py 的防回归自测（issue #214）。

运行：python3 skills/dsh-github-triage/scripts/test/test_check_dependabot_closed.py

覆盖：
1. 已关闭告警能被列出（含 state=fixed 的告警——GitHub 会在依赖升级后把 auto_dismissed 覆盖成 fixed）；
2. auto_dismissed_at / dismissed_by / dismissed_reason 为空时给出「非人工」判读，并把
   「auto_dismissed 已被清空」这一事实显式打印，避免读者误以为「没被自动关闭过」；
3. 「依赖仍以受影响版本留在 lockfile」→ 判定 ⚠ 仍受影响 + 退出码 1（qs 6.15.3 真值复现）；
4. 「依赖已升到修复版」→ 判定 ✔ + 退出码 0（qs 6.16.0 真值复现）；
5. 依赖已被移出依赖树 → 判读为已不再受影响；
6. 版本范围解析（>=/< 组合、逗号与空格分隔、^ / ~、||）。
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.abspath(os.path.join(HERE, "..", "check-dependabot-closed.py"))

QS_ALERT_TEMPLATE = {
    "number": 3,
    "state": "auto_dismissed",
    "created_at": "2026-09-02T16:05:37Z",
    "auto_dismissed_at": "2026-09-02T16:05:37Z",
    "dismissed_at": None,
    "dismissed_by": None,
    "dismissed_reason": None,
    "dismissed_comment": None,
    "fixed_at": None,
    "html_url": "https://github.com/baosfeng/my-dsh-plugins/security/dependabot/3",
    "dependency": {
        "package": {"ecosystem": "npm", "name": "qs"},
        "manifest_path": "package-lock.json",
        "scope": "development",
        "relationship": "transitive",
    },
    "security_advisory": {
        "ghsa_id": "GHSA-x5fp-wj9c-mxmx",
        "severity": "medium",
        "summary": "qs array-limit bypass via bracket-key comma parsing",
    },
    "security_vulnerability": {
        "severity": "medium",
        "vulnerable_version_range": ">= 6.14.2, <= 6.15.3",
        "first_patched_version": {"identifier": "6.16.0"},
    },
}


def fresh_alert(**overrides):
    alert = json.loads(json.dumps(QS_ALERT_TEMPLATE))
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(alert.get(key), dict):
            alert[key].update(value)
        else:
            alert[key] = value
    return alert


def lockfile_with_qs(version):
    return {
        "name": "fixture",
        "lockfileVersion": 3,
        "packages": {
            "": {"name": "fixture", "devDependencies": {"@stryker-mutator/core": "~9.0.0"}},
            "node_modules/@stryker-mutator/core": {
                "version": "9.0.0",
                "dev": True,
                "dependencies": {"typed-rest-client": "~2.3.0"},
            },
            "node_modules/typed-rest-client": {
                "version": "2.3.1",
                "dev": True,
                "dependencies": {"qs": "6.15.1"},
            },
            "node_modules/qs": {"version": version, "dev": True, "license": "BSD-3-Clause"},
        },
    }


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="dependabot-check-")
        self.repo = self.tmp.name
        self.addCleanup(self.tmp.cleanup)

    def write_lockfile(self, version=None, remove_qs=False):
        data = lockfile_with_qs(version) if version else lockfile_with_qs("6.15.3")
        if remove_qs:
            data["packages"].pop("node_modules/qs", None)
        with open(os.path.join(self.repo, "package-lock.json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def run_script(self, alerts, repo_dir=None, extra_args=()):
        payload = json.dumps({"dependabot": alerts, "code-scanning": [], "secret-scanning": []})
        proc = subprocess.run(
            [sys.executable, SCRIPT, "-", "--repo-dir", repo_dir or self.repo, *extra_args],
            input=payload,
            capture_output=True,
            text=True,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        return proc.returncode, proc.stdout + proc.stderr


class TestStillAffected(Base):
    """核心场景：告警被自动关闭，但依赖仍以受影响版本留在 lockfile（#214 的真实情形）。"""

    def test_auto_dismissed_but_still_vulnerable_exits_1(self):
        self.write_lockfile("6.15.3")
        code, out = self.run_script([fresh_alert()])
        self.assertEqual(code, 1, out)
        self.assertIn("⚠ 仍受影响", out)
        self.assertIn("6.15.3", out)
        self.assertIn("仍以受影响版本存在于 lockfile", out)
        self.assertIn("security/dependabot/3", out)

    def test_auto_dismissed_reported_as_non_human(self):
        self.write_lockfile("6.15.3")
        code, out = self.run_script([fresh_alert()])
        self.assertIn("（空=非人工）", out)
        self.assertIn("auto_dismissed=2026-09-02T16:05:37Z", out)
        self.assertIn("created=2026-09-02T16:05:37Z", out)

    def test_state_fixed_still_listed(self):
        """依赖升级后 GitHub 把 auto_dismissed 覆盖成 fixed；脚本仍必须列出该告警。"""
        self.write_lockfile("6.15.3")
        alert = fresh_alert(state="fixed", auto_dismissed_at=None, fixed_at="2026-09-12T13:20:40Z")
        code, out = self.run_script([alert])
        self.assertEqual(code, 1, out)
        self.assertIn("[fixed]", out)
        self.assertIn("auto_dismissed=（已被清空）", out)

    def test_header_warns_that_absence_is_not_proof(self):
        self.write_lockfile("6.16.0")
        _, out = self.run_script([fresh_alert(state="fixed", auto_dismissed_at=None)])
        self.assertIn("不能证明", out)


class TestAlreadyFixed(Base):
    def test_upgraded_dependency_exits_0(self):
        self.write_lockfile("6.16.0")
        code, out = self.run_script([fresh_alert(state="fixed", auto_dismissed_at=None)])
        self.assertEqual(code, 0, out)
        self.assertIn("✔ 已升到修复版", out)

    def test_dependency_removed_from_tree(self):
        self.write_lockfile("6.16.0", remove_qs=True)
        code, out = self.run_script([fresh_alert()])
        self.assertEqual(code, 0, out)
        self.assertIn("✔ 已不在依赖树", out)

    def test_no_closed_alerts_at_all(self):
        self.write_lockfile("6.16.0")
        code, out = self.run_script([])
        self.assertEqual(code, 0, out)
        self.assertIn("已关闭告警：0 条", out)
        self.assertIn("不能**单独证明", out)

    def test_parent_chain_reported(self):
        self.write_lockfile("6.15.3")
        _, out = self.run_script([fresh_alert()])
        self.assertIn("typed-rest-client", out)


class TestHistoricalLockfile(Base):
    """用 issue #199 修复前的真实 lockfile（qs 6.15.3）复跑，验证机制能自动浮现问题。"""

    REAL_REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

    def test_real_repo_history_flagged(self):
        import subprocess as sp

        sha = sp.run(
            ["git", "-C", self.REAL_REPO, "rev-parse", "92f270d^"],
            capture_output=True, text=True,
        )
        if sha.returncode != 0:
            self.skipTest("拿不到 #199 修复提交的父提交（浅克隆/非 git 环境）")
        raw = sp.run(
            ["git", "-C", self.REAL_REPO, "show", sha.stdout.strip() + ":package-lock.json"],
            capture_output=True, text=True,
        )
        if raw.returncode != 0:
            self.skipTest("拿不到历史 lockfile")
        with open(os.path.join(self.repo, "package-lock.json"), "w", encoding="utf-8") as fh:
            fh.write(raw.stdout)
        code, out = self.run_script([fresh_alert(), fresh_alert(number=2)])
        self.assertEqual(code, 1, out)
        self.assertIn("6.15.3", out)
        self.assertEqual(out.count("⚠ 仍受影响"), 2, out)

    def test_real_repo_current_lockfile_clean(self):
        raw = os.path.join(self.REAL_REPO, "package-lock.json")
        if not os.path.isfile(raw):
            self.skipTest("找不到当前 lockfile")
        with open(raw, encoding="utf-8") as fh:
            data = json.load(fh)
        with open(os.path.join(self.repo, "package-lock.json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        code, out = self.run_script([fresh_alert(state="fixed", auto_dismissed_at=None)])
        self.assertEqual(code, 0, out)


class TestRangeParsing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util

        spec = importlib.util.spec_from_file_location("check_dependabot_closed", SCRIPT)
        cls.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.mod)

    def test_ranges(self):
        f = self.mod.version_in_range
        self.assertTrue(f("6.15.3", ">= 6.14.2, <= 6.15.3"))
        self.assertFalse(f("6.16.0", ">= 6.14.2, <= 6.15.3"))
        self.assertTrue(f("2.3.0", ">= 2.2.5, < 6.16.0"))
        self.assertFalse(f("6.16.0", ">= 2.2.5, < 6.16.0"))
        self.assertTrue(f("6.15.1", ">= 6.11.1, <= 6.15.1"))
        self.assertTrue(f("1.5.0", ">= 1.0.0 < 2.0.0"))
        self.assertFalse(f("2.0.0", ">= 1.0.0 < 2.0.0"))
        self.assertTrue(f("1.2.9", "^1.2.3"))
        self.assertFalse(f("2.0.0", "^1.2.3"))
        self.assertTrue(f("1.2.9", "~1.2.3"))
        self.assertFalse(f("1.3.0", "~1.2.3"))
        self.assertTrue(f("0.9.2", "<0.9.3 || >=1.0.0"))
        self.assertIsNone(f("not-a-version", ">= 1.0.0"))
        self.assertIsNone(f("1.0.0", ""))


class TestInputValidation(Base):
    def test_missing_input_is_loud(self):
        proc = subprocess.run(
            [sys.executable, SCRIPT, "-", "--repo-dir", self.repo],
            input="", capture_output=True, text=True,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("ghops alerts", proc.stdout + proc.stderr)

    def test_garbage_input_is_loud(self):
        proc = subprocess.run(
            [sys.executable, SCRIPT, "-", "--repo-dir", self.repo],
            input="未配置凭据", capture_output=True, text=True,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("JSON", proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)

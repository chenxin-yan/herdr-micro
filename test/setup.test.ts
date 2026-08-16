import { describe, expect, test } from "bun:test";

import {
  LAUNCHD_LABEL,
  PLIST_MARKER,
  composeLaunchPath,
  decidePlistOwnership,
  decideUninstall,
  downLaunchctlCommands,
  failureDetail,
  isManagedPlist,
  launchctlServiceIsRunning,
  launchctlTarget,
  renderLaunchAgentPlist,
  upLaunchctlCommands,
  xmlEscape,
} from "../src/setup.ts";

describe("launchd setup", () => {
  test("escapes interpolated plist values", () => {
    expect(xmlEscape(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");

    const plist = renderLaunchAgentPlist({
      executable: "/tmp/a&b/herdr-micro",
      stdout: "/tmp/<out>",
      stderr: `/tmp/err's`,
      path: `/usr/bin:/tmp/a"b`,
    });
    expect(plist).toContain("/tmp/a&amp;b/herdr-micro");
    expect(plist).toContain("/tmp/&lt;out&gt;");
    expect(plist).toContain("/tmp/err&apos;s");
    expect(plist).toContain("/usr/bin:/tmp/a&quot;b");
    expect(plist).toContain(`<key>${PLIST_MARKER}</key>`);
  });

  test("recognizes only marked regular plists as ours", () => {
    const marked = `<dict><key>${PLIST_MARKER}</key><true/></dict>`;
    expect(isManagedPlist(marked)).toBe(true);
    expect(decidePlistOwnership({ kind: "missing" })).toBe("ours");
    expect(decidePlistOwnership({ kind: "regular", text: marked })).toBe("ours");
    expect(decidePlistOwnership({ kind: "regular", text: "<dict/>" })).toBe("external");
    expect(decidePlistOwnership({ kind: "other" })).toBe("external");

    expect(decideUninstall({ kind: "missing" })).toBe("stop-only");
    expect(decideUninstall({ kind: "regular", text: marked })).toBe("stop-and-remove");
    expect(decideUninstall({ kind: "regular", text: "<dict/>" })).toBe("refuse");
    expect(decideUninstall({ kind: "other" })).toBe("refuse");
  });

  test("reports spawn failures without stderr", () => {
    expect(failureDetail(null, new Error("spawn ENOENT"), null)).toBe("spawn ENOENT");
    expect(failureDetail("bad input\n", undefined, 1)).toBe("bad input");
    expect(failureDetail("", undefined, 9)).toBe("exit 9");
  });

  test("distinguishes a running launchd job from a registered crashed job", () => {
    expect(launchctlServiceIsRunning("state = running\nlast exit code = 0\n")).toBe(true);
    expect(launchctlServiceIsRunning("state = exited\nlast exit code = 1\n")).toBe(false);
  });

  test("builds the explicit PATH and launchctl command sequences", () => {
    expect(composeLaunchPath("/opt/homebrew/bin/herdr")).toBe(
      "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
    );
    expect(composeLaunchPath("/usr/bin/herdr")).toBe("/usr/bin:/bin:/usr/sbin:/sbin");

    const target = `gui/501/${LAUNCHD_LABEL}`;
    expect(launchctlTarget(501)).toBe(target);
    expect(upLaunchctlCommands(501, "/tmp/service.plist")).toEqual([
      ["/bin/launchctl", "enable", target],
      ["/bin/launchctl", "bootstrap", "gui/501", "/tmp/service.plist"],
      ["/bin/launchctl", "kickstart", target],
    ]);
    expect(downLaunchctlCommands(501)).toEqual([
      ["/bin/launchctl", "bootout", target],
      ["/bin/launchctl", "disable", target],
    ]);
  });
});

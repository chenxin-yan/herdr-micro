import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, type Config } from "../src/config.ts";
import { resolveTarget, sshTunnelArguments, targetNames, tunnelPaths } from "../src/targets.ts";

const config: Config = {
  ...DEFAULT_CONFIG,
  targets: {
    local: { socket: "/tmp/herdr.sock" },
    remote: { ssh: "workbox" },
  },
};

describe("Herdr Targets", () => {
  test("resolves the default Target and preserves configured order", () => {
    expect(targetNames(config)).toEqual(["local", "remote"]);
    expect(resolveTarget(config)).toEqual({
      name: "local",
      config: { socket: "/tmp/herdr.sock" },
      socket: "/tmp/herdr.sock",
    });
    expect(resolveTarget(config, "remote").socket).toBe("~/.config/herdr/herdr.sock");
  });

  test("builds a supervised SSH command with an owned ControlPath", () => {
    const paths = tunnelPaths("/tmp/herdr-micro-test", "remote");
    expect(sshTunnelArguments("workbox", paths, "/home/me/.config/herdr/herdr.sock")).toEqual([
      "ssh",
      "-N",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "StreamLocalBindUnlink=yes",
      "-o",
      "ServerAliveInterval=5",
      "-o",
      "ServerAliveCountMax=2",
      "-o",
      "ControlMaster=yes",
      "-o",
      "ControlPersist=no",
      "-o",
      "ControlPath=/tmp/herdr-micro-test/ssh-remote",
      "-L",
      "/tmp/herdr-micro-test/herdr-remote.sock:/home/me/.config/herdr/herdr.sock",
      "workbox",
    ]);
  });
});

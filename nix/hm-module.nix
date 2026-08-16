{ defaultPackage }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.herdr-micro;
in
{
  options.services.herdr-micro = {
    enable = lib.mkEnableOption "the herdr-micro Host service";

    package = lib.mkOption {
      type = lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalExpression "herdr-micro.packages.aarch64-darwin.herdr-micro";
      description = ''
        herdr-micro package to run. After activation, run the Nix-installed
        `herdr-micro setup` to provision the Deck without replacing the Nix-managed Host.
      '';
    };

    settings = lib.mkOption {
      type = lib.types.nullOr (lib.types.attrsOf lib.types.anything);
      default = null;
      description = ''
        Partial herdr-micro configuration, deep-merged over the built-in
        defaults by the Host. `targets` is an exception: when set, it replaces
        the built-in record wholesale, so keep a `local` Target (or set
        `defaultTarget`) when defining it. Leave null to use the built-in
        defaults without creating a configuration file.
      '';
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        assertions = [
          {
            assertion = pkgs.stdenv.hostPlatform.isDarwin;
            message = "services.herdr-micro is supported only on Darwin";
          }
        ];

        home.packages = [ cfg.package ];

        # `herdr-micro stop` writes a persistent launchd disable flag for the shared
        # label; bootstrap of a disabled service fails with I/O error 5, so clear it
        # before Home Manager bootstraps the agent.
        home.activation.herdrMicroEnable = lib.hm.dag.entryBefore [ "setupLaunchAgents" ] ''
          /bin/launchctl enable "gui/$UID/dev.herdr.herdr-micro" || true
        '';

        # The shared label makes Home Manager and the CLI target one plist; the CLI marker rule preserves HM ownership.
        launchd.agents.herdr-micro = {
          enable = true;
          config = {
            Label = "dev.herdr.herdr-micro";
            ProgramArguments = [ (lib.getExe cfg.package) ];
            RunAtLoad = true;
            KeepAlive.SuccessfulExit = false;
            ThrottleInterval = 30;
            StandardOutPath = "${config.home.homeDirectory}/Library/Logs/herdr-micro/stdout.log";
            StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/herdr-micro/stderr.log";
            EnvironmentVariables.PATH = "/usr/bin:/bin:/usr/sbin:/sbin:${config.home.profileDirectory}/bin";
          };
        };
      }

      (lib.mkIf (cfg.settings != null) {
        xdg.configFile."herdr-micro/config.json".text = builtins.toJSON cfg.settings;
      })
    ]
  );
}

{
  description = "Physical control deck for Herdr coding agents";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
      inherit (pkgs) lib;
      version = (lib.importJSON ./package.json).version;

      node_modules = pkgs.stdenv.mkDerivation {
        pname = "herdr-micro-node_modules";
        inherit version;
        src = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [
            ./package.json
            ./bun.lock
          ];
        };

        nativeBuildInputs = [
          pkgs.bun
          pkgs.writableTmpDirAsHomeHook
        ];

        dontConfigure = true;

        buildPhase = ''
          runHook preBuild

          export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
          bun install --frozen-lockfile --production --ignore-scripts --no-progress

          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall

          mkdir -p $out
          cp -R node_modules $out

          runHook postInstall
        '';

        dontFixup = true;
        # Update this hash whenever package.json or bun.lock changes dependencies.
        outputHash = "sha256-xZH7cGMID9CCWx7EaIY0ZSBhQcDlmjyu7/Am8jjNALE=";
        outputHashMode = "recursive";
      };

      herdr-micro = pkgs.stdenv.mkDerivation {
        pname = "herdr-micro";
        inherit version;
        src = self;

        strictDeps = true;
        __structuredAttrs = true;

        nativeBuildInputs = [
          pkgs.bun
          pkgs.writableTmpDirAsHomeHook
        ];

        configurePhase = ''
          runHook preConfigure

          cp -R ${node_modules}/node_modules .
          chmod -R u+w node_modules

          runHook postConfigure
        '';

        buildPhase = ''
          runHook preBuild

          mkdir -p .bun-tmp .bun-install
          BUN_TMPDIR=$PWD/.bun-tmp \
          BUN_INSTALL=$PWD/.bun-install \
            bun build --compile --minify \
              --no-compile-autoload-bunfig \
              --no-compile-autoload-dotenv \
              ./src/main.ts \
              --outfile herdr-micro
          # Bytecode is omitted because compiled bytecode is coupled to Bun's exact version.

          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall

          install -Dm755 herdr-micro $out/bin/herdr-micro
          install -Dm644 package.json $out/package.json
          install -Dm644 device/boot.py $out/device/boot.py
          install -Dm644 device/protocol.py $out/device/protocol.py
          install -Dm644 device/code.py $out/device/code.py

          runHook postInstall
        '';

        dontFixup = true;
        dontStrip = true;

        doInstallCheck = true;
        nativeInstallCheckInputs = [ pkgs.writableTmpDirAsHomeHook ];
        installCheckPhase = ''
          runHook preInstallCheck

          $out/bin/herdr-micro --version | grep -F ${lib.escapeShellArg version}

          runHook postInstallCheck
        '';

        passthru = { inherit node_modules; };

        meta = {
          description = "Physical control deck for Herdr coding agents";
          homepage = "https://github.com/chenxin-yan/herdr-micro";
          mainProgram = "herdr-micro";
          platforms = [ "aarch64-darwin" ];
        };
      };
    in
    {
      packages.${system} = {
        inherit herdr-micro;
        default = herdr-micro;
      };

      apps.${system}.default = {
        type = "app";
        program = lib.getExe herdr-micro;
      };

      homeManagerModules.default = import ./nix/hm-module.nix {
        defaultPackage = self.packages.${system}.herdr-micro;
      };
    };
}

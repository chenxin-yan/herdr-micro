{
  description = "Physical control deck for Herdr coding agents";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
      inherit (pkgs) lib;
      packageJson = lib.importJSON ./package.json;
      version = packageJson.version;
      # Single source of truth: npm's files list decides which device sources ship.
      deviceFiles = lib.filter (f: lib.hasPrefix "device/" f) packageJson.files;

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
          # Single source of truth: install flags live in package.json scripts.
          bun run install:prod

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
          # Single source of truth: compile flags live in package.json scripts.
          BUN_TMPDIR=$PWD/.bun-tmp \
          BUN_INSTALL=$PWD/.bun-install \
            bun run build:binary

          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall

          install -Dm755 dist/herdr-micro $out/bin/herdr-micro
          install -Dm644 package.json $out/package.json
          for f in ${lib.escapeShellArgs deviceFiles}; do
            install -Dm644 "$f" "$out/$f"
          done

          runHook postInstall
        '';

        dontFixup = true;

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

      homeManagerModules.default = import ./nix/hm-module.nix {
        defaultPackage = self.packages.${system}.herdr-micro;
      };
    };
}

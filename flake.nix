{
  description = "Lightweight OpenTelemetry viewer for local development";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          pname = "otel-gui";
          version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
          src = self;
          nodejs = pkgs.nodejs_22;
          pnpm = pkgs.pnpm_11;
          package = pkgs.stdenvNoCC.mkDerivation {
            inherit pname version src;

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.pnpmConfigHook
              pkgs.makeWrapper
            ];

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit pname version src pnpm;
              fetcherVersion = 4;
              hash = "sha256-/XmdWuECHUdhNifnum7P0E4r59tsH4eX+D15meb09AA=";
            };

            buildPhase = ''
              runHook preBuild
              pnpm run build
              pnpm run sea:bundle
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              CI=true pnpm install --prod --offline --frozen-lockfile --ignore-scripts

              appDir="$out/lib/otel-gui"
              mkdir -p "$appDir" "$out/bin"
              cp -r build node_modules package.json packages proto "$appDir/"
              cp dist/sea-launcher.cjs "$appDir/otel-gui.cjs"

              makeWrapper ${nodejs}/bin/node "$out/bin/otel-gui" \
                --add-flags "$appDir/otel-gui.cjs"
              runHook postInstall
            '';

            meta = {
              description = "Lightweight OpenTelemetry viewer for traces, logs, and metrics";
              homepage = "https://github.com/metafab/otel-gui";
              license = pkgs.lib.licenses.mit;
              mainProgram = "otel-gui";
              platforms = [
                "x86_64-linux"
                "aarch64-linux"
                "aarch64-darwin"
              ];
            };
          };
        in
        {
          default = package;
          otel-gui = package;
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/otel-gui";
        };
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.pnpm_11
            ];

            shellHook = ''
              echo "Node $(node --version) | pnpm $(pnpm --version)"
            '';
          };
        }
      );
    };
}

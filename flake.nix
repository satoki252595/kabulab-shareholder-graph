{
  description = "Shareholder map static site";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" ];
      each = f: nixpkgs.lib.genAttrs systems (system:
        f (import nixpkgs { inherit system; }));
    in {
      devShells = each (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.python3 ];
        };
      });
    };
}

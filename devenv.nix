{ ... }:
let
  shell = { pkgs, ... }: {
    packages = [
      pkgs.nodejs
      pkgs.github-copilot-cli
    ];

    # Pre-commit hooks for code quality
    git-hooks.hooks = {
      # ESLint with auto-fix
      eslint = {
        enable = true;
        name = "eslint";
        entry = "npm run lint:fix --";
        files = "\\.(ts|js|mjs)$";
        pass_filenames = true;
      };

      # Prettier formatting
      prettier = {
        enable = true;
        name = "prettier";
        entry = "npm run format --";
        files = "\\.(ts|js|mjs|json|md)$";
        pass_filenames = true;
      };

      # TypeScript type-checking (fast check on changed files only)
      typecheck = {
        enable = true;
        name = "typecheck";
        entry = "npm run typecheck";
        files = "\\.ts$";
        pass_filenames = false;  # tsc needs full project context
      };
    };
  };
in
{
  profiles.shell.module = {
    imports = [ shell ];
  };
}

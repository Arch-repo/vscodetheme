# Anto426 Rofi Dynamic

Single VS Code theme for the Anto426 Hyprland setup.

The theme mirrors the rofi control menu palette: dark glass-like surfaces,
soft borders, compact contrast, and one wallpaper-driven accent. The generated
theme file is:

```text
themes/Anto426-Rofi-Dynamic.json
```

The Arch installer builds this extension and the dotfiles color engine rewrites
that theme whenever `~/.config/anto426/wallpaper_effects.sh` regenerates the
desktop palette.

## Build

```bash
yarn install --frozen-lockfile
yarn build
```

## Install Locally

```bash
yarn package
code --install-extension anto426-vscode-theme-*.vsix --force
```

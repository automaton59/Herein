# Renderer dependency notices

Portable generation copies installed dependency LICENSE/COPYING/NOTICE files and records package versions. These two upstream notices are included separately because they are absent from the installed packages:

- `colord-2.9.6.md`: [pixijs/colord LICENSE.md](https://github.com/pixijs/colord/blob/5344fbf77b736f81cd33c21050021bc09bc9dd1d/LICENSE.md), at the npm `@pixi/colord@2.9.6` gitHead `5344fbf77b736f81cd33c21050021bc09bc9dd1d`.
- `cubism-web-framework.md`: [CubismWebFramework LICENSE.md](https://github.com/guansss/CubismWebFramework/blob/4bbfb54d6787daec3a7911c6550b5d39dcb3a263/LICENSE.md), submodule of `pixi-live2d-display@0.5.0-beta` npm gitHead `08eb44255709501f3c85c19ec9fee2abff5177a0`.

The framework notice covers the bundled Cubism Web Framework. Cubism Core and model assets are separate local inputs and are not included in the portable package.

Installed `@pixi/text-html@7.4.3` lacks a license file. Its package metadata identifies the same PixiJS 7.4.3 monorepo and MIT license; portable generation includes that release's `@pixi/core/LICENSE` notice for it. No dependency source, SDK Core or model is copied into this notice directory.

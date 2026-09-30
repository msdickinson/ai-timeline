import * as esbuild from "esbuild";

// Build the VS Code extension
await esbuild.build({
  entryPoints: ["src/vscode/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
});

console.log("VS Code extension built → dist/extension.js");

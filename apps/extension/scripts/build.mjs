import { build, context } from "esbuild";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
await mkdir("dist", { recursive: true });
await copyFile("manifest.json", "dist/manifest.json");
await copyFile("preview.html", "dist/index.html");
const options = {
  entryPoints: ["src/content.ts", "src/background.ts", "src/preview.ts"],
  bundle: true,
  outdir: "dist",
  target: "chrome120",
  format: "iife",
  loader: { ".css": "text" },
  legalComments: "none",
  minify: true,
};
if (process.argv.includes("--serve")) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ servedir: "dist", host: "127.0.0.1", port: 5173 });
  console.log(
    "Preview: http://127.0.0.1:5173 (UI fixtures; no paid API calls)",
  );
} else {
  await build(options);
  // Fail the build if a provider credential was accidentally bundled.
  for (const name of ["content.js", "background.js", "preview.js"]) {
    if (
      /apify_api_[A-Za-z0-9]{15,}|AIza[A-Za-z0-9_-]{30,}/.test(
        await readFile(path.join("dist", name), "utf8"),
      )
    ) {
      throw new Error(`Credential detected in ${name}`);
    }
  }
  console.log("Load unpacked:", path.join(root, "dist"));
}

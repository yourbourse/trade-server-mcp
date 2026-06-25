// Build the Claude Desktop Extension (.mcpb).
//
// Stages a clean, production-only bundle (manifest + dist + prod node_modules + package.json + icon)
// and packs it with the MCPB CLI. Run via `npm run pack:mcpb`. The output .mcpb is gitignored.
import { execSync } from "node:child_process";
import { rmSync, mkdirSync, cpSync, copyFileSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "mcpb-build");
const out = join(root, "trade-server-mcp.mcpb");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

// 1. Build TypeScript -> dist/
run("npm run build");

// 2. Manifest and package versions must match (so the published extension version is honest).
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (pkg.version !== manifest.version) {
  console.error(
    `Version mismatch: package.json ${pkg.version} != manifest.json ${manifest.version}. ` +
      `Update manifest.json "version" to match.`,
  );
  process.exit(1);
}

// 3. Clean staging dir.
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// 4. Production-only node_modules in staging.
//    --ignore-scripts is REQUIRED: package.json's "prepare" runs tsc, which needs the typescript
//    devDependency (absent under --omit=dev) and src/ (not staged). dist/ is already built in step 1.
copyFileSync(join(root, "package.json"), join(staging, "package.json"));
copyFileSync(join(root, "package-lock.json"), join(staging, "package-lock.json"));
run("npm ci --omit=dev --ignore-scripts", staging);
rmSync(join(staging, "package-lock.json"), { force: true }); // only needed for the install; keep it out of the bundle

// 5. Copy the bundle payload.
cpSync(join(root, "dist"), join(staging, "dist"), { recursive: true });
rmSync(join(staging, "dist", "test"), { recursive: true, force: true }); // never ship compiled tests
copyFileSync(join(root, "manifest.json"), join(staging, "manifest.json"));
copyFileSync(join(root, "icon.png"), join(staging, "icon.png"));
copyFileSync(join(root, "LICENSE"), join(staging, "LICENSE")); // ship our license with the artifact
copyFileSync(join(root, ".mcpbignore"), join(staging, ".mcpbignore")); // trim dependency cruft at pack time

// 6. Validate the staged manifest, then pack.
run(`npx --yes @anthropic-ai/mcpb@2.1.2 validate "${join(staging, "manifest.json")}"`);
run(`npx --yes @anthropic-ai/mcpb@2.1.2 pack "${staging}" "${out}"`);

console.log(`\n✓ Built ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);

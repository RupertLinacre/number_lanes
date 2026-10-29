import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// Check the built files using the manifest ID's origin-relative resolution rules.
const origin = "https://example.test";
const html = readFileSync("dist/index.html", "utf8");
const link = html.match(/<link\s+rel="manifest"\s+href="([^"]+)"/);
assert.ok(link, "Built page must link to a web app manifest");
const manifestUrl = new URL(link[1], origin);
const basePath = new URL(".", manifestUrl).pathname;
const manifest = JSON.parse(readFileSync("dist/manifest.webmanifest", "utf8"));
const start = new URL(manifest.start_url, manifestUrl);
const scope = new URL(manifest.scope, manifestUrl);
const id = new URL(manifest.id, start.origin + "/");
assert.equal(id.href, origin + basePath, "Manifest ID must identify this deployment path");
assert.equal(start.href, origin + basePath, "Start URL must open this deployment");
assert.equal(scope.href, origin + basePath, "Scope must be this deployment path");
assert.equal(manifest.display, "standalone");
for (const size of [192, 512]) {
  const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}` && entry.type === "image/png");
  assert.ok(icon, `Missing ${size}px PNG icon`);
  const iconUrl = new URL(icon.src, manifestUrl);
  assert.ok(iconUrl.pathname.startsWith(basePath), "Icon must be under the deployment path");
  assert.ok(existsSync(`dist/${iconUrl.pathname.slice(basePath.length)}`), `Missing built icon ${icon.src}`);
}
console.log(`PWA manifest verified: ${basePath}`);

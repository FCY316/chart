import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

/** Node 测试直接加载项目 TS/TSX；每个入口独立缓存，保留真实 UI 原语。 */
export function loadTypeScript(file, overrides = {}, cache = new Map()) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const loadedModule = { exports: {} };
  cache.set(absolute, loadedModule);
  const code = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (overrides[name]) return name === "react" ? { ...require("react"), ...overrides[name] } : overrides[name];
    if (!name.startsWith("@/")) return require(name);
    const base = path.resolve(name.slice(2));
    const resolved = [".ts", ".tsx"].map((extension) => base + extension).find((file) => fs.existsSync(file));
    if (!resolved) throw new Error(`无法加载 ${name}`);
    return loadTypeScript(resolved, overrides, cache);
  };
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

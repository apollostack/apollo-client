import * as path from "path";
import * as recast from "recast";
import * as parser from "recast/parsers/babel";
import glob = require("glob");

export const distDir = path.resolve(__dirname, "..", "dist");

export function eachFile(dir: string, callback: (
  absPath: string,
  relPath: string,
) => any) {
  const promises: Promise<any>[] = [];

  return new Promise<void>((resolve, reject) => {
    glob(`${dir}/**/*.js`, (error, files) => {
      if (error) return reject(error);

      files.sort().forEach(file => {
        const relPath = path.relative(dir, file);

        // Outside the distDir, somehow.
        if (relPath.startsWith("../")) return;

        // Avoid re-transforming CommonJS bundle files.
        if (relPath.endsWith(".cjs.js")) return;
        if (relPath.endsWith(".cjs")) return;

        // Avoid re-transforming CommonJS bundle files.
        if (relPath.endsWith(".min.js")) return;

        // This file is not meant to be imported or processed.
        if (relPath.endsWith("invariantErrorCodes.js")) return;

        promises.push(new Promise(resolve => {
          resolve(callback(file, relPath));
        }));
      });

      resolve();
    });
  }).then(() => Promise.all(promises));
}

export function reparse(source: string) {
  return recast.parse(source, { parser });
}

export function reprint(ast: ReturnType<typeof reparse>) {
  return recast.print(ast).code;
}

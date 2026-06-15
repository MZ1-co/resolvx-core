import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index:  "src/index.ts",
    result: "src/result.ts",
    async:  "src/async.ts",
    cache:  "src/cache.ts",
    fmt:    "src/fmt.ts",
    log:    "src/log.ts",
    net:    "src/net.ts",
    types:  "src/types.ts",
  },
  format:          ["esm", "cjs"],
  dts:             true,
  sourcemap:       true,
  clean:           true,
  treeshake:       true,
  splitting:       false,
  minify:          false,       // readable output
  bundle:          true,
  external:        ["chalk"],   // peer dep — don't bundle
  esbuildOptions: (opts) => {
    opts.conditions = ["import", "default"];
  },
});

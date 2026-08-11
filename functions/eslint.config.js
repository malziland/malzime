const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");

module.exports = [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        Promise: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        /* v3.0 Phase 1: Der Live-Text-Strom dekodiert SSE-Chunks mit
           TextDecoder({stream:true}) — wie TextEncoder ein Node-Global. */
        TextDecoder: "readonly",
        AbortController: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
      "no-console": "off",
    },
  },
  {
    files: ["src/__tests__/**/*.js"],
    languageOptions: {
      globals: {
        test: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
        fail: "readonly",
        /* v3.0 Phase 1: Zum Nachstellen einer gestreamten Mistral-Antwort
           (mistral-livetext.test.js) — Node-Global seit Node 18. */
        ReadableStream: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "coverage/"],
  },
];

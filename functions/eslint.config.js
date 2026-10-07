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
        AbortSignal: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "no-console": "off",
      /* SPERRKLINKE JE FUNKTION (TEST-2026-10-03-44). Die Zahlen sind der Stand
         vom 07.10.2026: die verzweigteste und die laengste Funktion des Servers
         (beide handleEnqueue). Keine Zielwerte — sie verhindern nur, dass es
         mehr wird. Wer eine der beiden kleiner macht, zieht die Zahl nach. */
      complexity: ["error", 63],
      "max-lines-per-function": ["error", { max: 369, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: ["src/__tests__/**/*.js"],
    /* Tests sind lange Gruppen in einer Funktion — die Sperrklinke gilt dem Programm. */
    rules: { complexity: "off", "max-lines-per-function": "off" },
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

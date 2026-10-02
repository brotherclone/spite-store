import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Math functions whose precision ECMAScript leaves implementation-defined.
const transcendental = [
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'cbrt',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'hypot',
  'log',
  'log10',
  'log1p',
  'log2',
  'pow',
  'sin',
  'sinh',
  'tan',
  'tanh',
];
const locale = [
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleUpperCase',
  'toLocaleLowerCase',
  'localeCompare',
];
const determinism = 'The engine must be deterministic and portable (see design D5/D7).';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'openspec/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['packages/player/src/**', 'site/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['packages/engine/src/**'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'Intl', 'TextEncoder', 'TextDecoder', 'crypto'].map((name) => ({
          name,
          message: determinism,
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: determinism },
        ...transcendental.map((property) => ({ object: 'Math', property, message: determinism })),
        ...locale.map((property) => ({ property, message: determinism })),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: determinism },
        { selector: "AssignmentExpression[operator='**=']", message: determinism },
      ],
    },
  },
);

// @ts-check
/**
 * ESLint 10, flat config — единый для всего монорепо (`shared`, `frontend`, `backend`).
 *
 * Главная задача конфига, помимо обычного набора правил, — технически запретить то,
 * что запрещено рулсетом §F: приведения типов (`as`, `<T>`, `!`), `any`, `@ts-*`
 * и работу с небезопасными значениями. Нарушение = ошибка, а не предупреждение:
 * предупреждения воркер игнорирует.
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.vite/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- RULES.md §F: приведения типов и дыры в типах ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // --- прочее, что ловит ошибки раньше браузера ---
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Фронтенд: правила React.
  {
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `console.log` во фронте не заменяет нормальный вывод ошибок
      'no-console': 'error',
    },
  },

  // Примитивы интерфейса: канонические компоненты shadcn/ui держат рядом и компонент,
  // и его варианты оформления (cva). Правило fast-refresh этого не любит, но дробить
  // файл на `button.tsx` и `button-variants.ts` ради предупреждения — лишняя косметика.
  {
    files: ['frontend/src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  // Тесты фронтенда: обращения к методам объектов (хуков, клиентов) здесь безопасны — `this`
  // нигде не используется, а правило ловило бы ложные срабатывания на каждом `await client.getPark()`.
  {
    files: ['frontend/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Чистый JS/MJS (служебные скрипты, конфиги): type-checked правила неприменимы,
  // потому что у этих файлов нет TS-проекта. Глобальные объекты Node объявляем явно —
  // без них `no-undef` ругается на console/process (и это не косметика: правило
  // ловит опечатки в именах, если список глобалов задан).
  {
    files: ['**/*.{js,mjs,cjs}', '**/*.d.mts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Скрипты и конфиги: работают с внешним миром (JSON, env) — ослабляем только правило про консоль.
  {
    files: [
      '**/*.config.{ts,js,mjs}',
      'backend/src/db/migrations/**',
      'scripts/**',
      // Диагностические сценарии бэкенда: их смысл — печатать состояние в консоль.
      'backend/scripts/**',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  // Тесты: правила типизации те же (фикстуры — через фабрики и zod),
  // но разрешены матчеры, работающие с any-подобными значениями.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', 'frontend/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
    },
  },

  prettier,
);

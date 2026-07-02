import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Run *.test.tsx files (React component tests) in a jsdom environment so
  // @testing-library/react can render. Node remains the default for *.test.ts.
  projects: [
    {
      preset: 'ts-jest',
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
      // @react-pdf/renderer and its @react-pdf/* dependencies ship as native
      // ESM ("type": "module") with no CJS build, so they must be
      // transpiled rather than skipped like the rest of node_modules. There's
      // no @babel/preset-env in this repo, so route their .js files through
      // ts-jest (allowJs is already on) instead of adding a new dependency.
      transformIgnorePatterns: [
        '/node_modules/(?!.*(@react-pdf|@swc/helpers|color-string|color-name|fontkit|jay-peg|linebreak|unicode-properties|restructure|png-js|yoga-layout)/)',
      ],
      transform: {
        // yoga-layout's WASM loader uses `import.meta.url`, which has no
        // CommonJS equivalent — must be pre-processed before ts-jest sees it.
        'yoga-layout[\\\\/]dist[\\\\/]binaries[\\\\/]yoga-wasm-base64-esm\\.js$':
          '<rootDir>/jest.yoga-wasm-transform.js',
        '^.+\\.tsx?$': ['ts-jest', {}],
        '^.+\\.js$': ['ts-jest', { isolatedModules: true }],
      },
    },
    {
      preset: 'ts-jest',
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    },
  ],
}
export default config

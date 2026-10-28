import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import svgr from 'vite-plugin-svgr'

// The public template uses this Material Symbols bridge in app/vite.config.ts too. Component tests must exercise
// those same React SVGs without requiring the optional, private @higgsfield-ai/icons package.
const publicIcons = fileURLToPath(new URL('../../src/lib/quanta-material-icons.ts', import.meta.url))

function publicIconSvgr() {
  const plugin = svgr({
    svgrOptions: {
      icon: true,
      svgProps: { fill: 'currentColor' },
      svgoConfig: {
        plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }],
      },
    },
  })
  const load = plugin.load
  if (typeof load !== 'function') throw new Error('Expected the SVGR load hook')
  // Vitest's Vite 8 runner uses Rolldown, but this plugin resolves the app's Vite 7 peer. Select SVGR's supported
  // esbuild path instead of asking that peer for Vite 8's transformWithOxc. Keep the rest of the plugin context.
  plugin.load = function (...args) {
    const context = Object.create(this)
    Object.defineProperty(context, 'meta', { value: { ...this.meta, rolldownVersion: undefined } })
    return load.apply(context, args)
  }
  return plugin
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'codegen',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'runtime',
          environment: 'happy-dom',
          include: ['src/runtime/**/*.test.ts'],
        },
      },
      {
        plugins: [publicIconSvgr()],
        resolve: {
          alias: [{ find: /^@higgsfield-ai\/icons(\/.*)?$/, replacement: publicIcons }],
        },
        test: {
          name: 'components',
          environment: 'happy-dom',
          include: ['src/components/**/*.test.tsx'],
          setupFiles: ['./src/test/setup-components.ts'],
          alias: {
            'use-sync-external-store/shim/with-selector':
              'use-sync-external-store/shim/with-selector.js',
            'use-sync-external-store/shim': 'use-sync-external-store/shim/index.js',
            'use-sync-external-store/with-selector': 'use-sync-external-store/with-selector.js',
          },
          server: {
            deps: {
              inline: [/use-sync-external-store/, /@base-ui\/react/],
            },
          },
        },
      },
    ],
  },
})

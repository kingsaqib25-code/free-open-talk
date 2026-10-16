import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    minify: false,
    splitting: false,
    bundle: true,
    external: [
        // External packages that should not be bundled
        'mediasoup',
        'bcrypt',
        '@free2talk/shared',
    ],
    noExternal: [
        // Everything else gets bundled
    ],
});

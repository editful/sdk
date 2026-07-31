import {
  definePlugin,
  type PluginJson,
} from './index.js';

// @ts-expect-error SceneStore is deliberately not part of the public SDK.
import type { SceneStore } from './index.js';

declare const privateStore: SceneStore;
void privateStore;

definePlugin({
  register(context) {
    const alpha = context.kind('fixture:alpha');
    const alphaLevel = alpha.field.f64('level');
    const beta = context.kind('fixture:beta');
    const betaLevel = beta.field.f64('level');

    alpha.pack((node) => {
      node.get(alphaLevel);
      // @ts-expect-error A field handle is branded to its declaring kind.
      node.get(betaLevel);
    });

    // @ts-expect-error Field declarations use stable string names, never indices.
    alpha.field.string(3);

    context.command({
      id: 'fixture:bad-output',
      label: 'Bad output',
      // @ts-expect-error Human commands cannot return arbitrary values.
      async run() {
        await Promise.resolve();
        return 1;
      },
    });

    context.command({
      id: 'fixture:toolbar-command',
      label: 'Toolbar command',
      shortcut: 'mod+shift+u',
      toolbar: {
        label: 'Unsplash',
        icon: './unsplash.svg',
        order: 40,
        activeEditor: 'fixture:photo-browser',
      },
      async run() {
        await Promise.resolve();
      },
    });

    context.action({
      id: 'fixture:bad-schema',
      name: 'bad_schema',
      description: 'Compile-time JSON schema boundary',
      // @ts-expect-error Agent schemas must be JSON-serializable.
      inputSchema: { type: 'object', validate: () => true },
      outputSchema: { type: 'null' },
      requiresConfirmation: false,
      async run(): Promise<PluginJson> {
        await Promise.resolve();
        return null;
      },
    });
  },
});

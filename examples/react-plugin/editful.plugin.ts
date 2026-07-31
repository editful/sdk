import { definePluginConfig } from '@editful/plugin-tools';

export default definePluginConfig({
  id: 'example:react-counter',
  name: 'React Counter',
  description: 'A minimal React-powered Editful sidebar plugin.',
  version: '1.0.0',
  entry: './src/index.tsx',
  minAppVersion: '0.9.0',
  maxAppVersion: '0.10.0',
  capabilities: ['commands', 'editor-ui'],
  assets: { icons: ['./assets/spark.svg'] },
});

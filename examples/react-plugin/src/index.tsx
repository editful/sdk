import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { definePlugin } from '@editful/canvas-sdk';

const EDITOR_ID = 'example:react-counter';

export default definePlugin({
  register(context) {
    context.editor({
      id: EDITOR_ID,
      label: 'React Counter',
      surface: 'right-sidebar',
      activation: 'manual',
      mount(container, action) {
        const root = createRoot(container);
        root.render(
          <Counter
            notify={(count) => action.ui.notify({
              title: `Counted to ${count}`,
              tone: 'success',
            })}
          />,
        );
        return { dispose: () => root.unmount() };
      },
    });

    context.command({
      id: 'example:open-react-counter',
      label: 'Open React Counter',
      toolbar: {
        icon: './assets/spark.svg',
        label: 'Counter',
        activeEditor: EDITOR_ID,
        order: 60,
      },
      async run(action) {
        action.editors.open(EDITOR_ID);
      },
    });
  },
});

function Counter({ notify }: { readonly notify: (count: number) => void }) {
  const [count, setCount] = useState(0);
  const increment = () => {
    setCount((value) => {
      const next = value + 1;
      notify(next);
      return next;
    });
  };

  return (
    <section style={{ display: 'grid', gap: 12, padding: 12 }}>
      <strong>React is bundled and running.</strong>
      <span>Count: {count}</span>
      <button type="button" onClick={increment}>Increment</button>
    </section>
  );
}

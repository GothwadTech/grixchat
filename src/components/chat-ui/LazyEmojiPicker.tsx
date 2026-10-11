import React, { Suspense, lazy } from 'react';

/**
 * `emoji-picker-react` is a heavy dependency (~200 kB) that used to be
 * statically imported by both `ChatMessageMenu` and `EmojiPickerMenu`, which
 * dragged it into the chat chunk even though the picker only appears after a
 * tap. Loading it through `React.lazy` here puts it in its own chunk.
 *
 * `theme` is typed as a plain string on purpose: importing the package's
 * `Theme` enum would be a *static* import and defeat the code splitting.
 */
const EmojiPicker = lazy(() => import('emoji-picker-react'));

type EmojiPickerModule = typeof import('emoji-picker-react');
type EmojiPickerProps = React.ComponentProps<EmojiPickerModule['default']>;

export type LazyEmojiPickerProps = Omit<EmojiPickerProps, 'theme'> & {
  theme?: 'light' | 'dark' | 'auto';
};

export const LazyEmojiPicker: React.FC<LazyEmojiPickerProps> = ({ theme, ...rest }) => (
  <Suspense
    fallback={
      <div
        className="bg-[var(--bg-card)] animate-pulse rounded-2xl"
        style={{ width: typeof rest.width === 'number' ? rest.width : 300, height: 350 }}
      />
    }
  >
    <EmojiPicker
      {...(rest as EmojiPickerProps)}
      theme={theme as EmojiPickerProps['theme']}
    />
  </Suspense>
);

export default LazyEmojiPicker;

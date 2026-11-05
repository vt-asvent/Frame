import type { Config } from 'tailwindcss';
import base from '../tailwind.config';

// El tema de la app, pero solo con las clases que usa esta página.
export default {
  ...base,
  content: {
    relative: true,
    files: [
      './index.html',
      './src/**/*.{ts,tsx}',
      '../src/components/ui/{button,card,dialog,dropdown-menu,input,tabs,toast,toaster}.tsx',
      '../src/components/shared/EchoWord.tsx',
      '../src/components/layout/FrameLogo.tsx',
    ],
  },
} satisfies Config;

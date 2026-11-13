import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  // Sin los textos legales ni los diccionarios: son prosa y Tailwind sacaba
  // de ellos clases que nadie usa (1.7.0; todos los idiomas desde 1.9.0).
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/lib/legal/**', '!./src/lib/i18n-*.ts'],
  theme: {
    extend: {
      fontFamily: {
        // Poppins no trae cirílico ni japonés (1.7.3): esas letras salen de
        // las fuentes del sistema que siguen, letra por letra.
        body: ['Poppins', 'Segoe UI', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', 'sans-serif'],
        // `--font-headline`: la tipografía de títulos de Animaciones (1.8.0);
        // sin ella, Poppins como siempre.
        headline: ['var(--font-headline, Poppins)', 'Segoe UI', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', 'sans-serif'],
        display: ['Poppins', 'Segoe UI', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', 'sans-serif'],
        code: ['monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // Los grandes siguen a `--radius` (1.9.8): con el valor de fábrica dan lo mismo que antes.
        xl: 'calc(var(--radius) * 1.5)',
        '2xl': 'calc(var(--radius) * 2)',
        '3xl': 'calc(var(--radius) * 3)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        // El brillo del dial de Enfoque durante una sesión, respirando: lo
        // lleva el micrófono de la barra superior mientras graba.
        'session-glow': {
          '0%, 100%': { boxShadow: '0 0 6px 0 hsl(var(--primary) / 0.35)' },
          '50%': { boxShadow: '0 0 18px 4px hsl(var(--primary) / 0.6)' },
        },
        // La barra de una subida o bajada de Wire, yendo y viniendo.
        'wire-slide': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        'pulse-border': {
          '0%, 100%': {
            borderColor: 'hsl(var(--border))',
            boxShadow: '0 0 0 0 hsl(var(--primary) / 0)',
          },
          '50%': {
            borderColor: 'hsl(var(--primary))',
            boxShadow: '0 0 15px 3px hsl(var(--primary) / 0.5)',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        marquee: 'marquee 15s linear infinite',
        'pulse-border': 'pulse-border 1.5s ease-in-out 3',
        'pulse-border-infinite': 'pulse-border 1.5s ease-in-out infinite',
        'session-glow': 'session-glow 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;

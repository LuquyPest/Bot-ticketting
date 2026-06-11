/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base:    'var(--color-base)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          card:    'var(--color-surface-card)',
          hover:   'var(--color-surface-hover)',
          elevated:'var(--color-surface-elevated)',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.07)',
          hover:   'rgba(255,255,255,0.12)',
          focus:   'rgba(124,110,243,0.5)',
        },
        primary: {
          DEFAULT: '#7c6ef3',
          light:   '#a78bfa',
          dark:    '#5b4fe8',
          muted:   'rgba(124,110,243,0.15)',
          glow:    'rgba(124,110,243,0.3)',
        },
        ink: {
          1: 'var(--color-ink-1)',
          2: 'var(--color-ink-2)',
          3: 'var(--color-ink-3)',
          4: 'var(--color-ink-4)',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in':      'fadeIn 0.18s ease-out',
        'slide-up':     'slideUp 0.2s ease-out',
        'slide-down':   'slideDown 0.2s ease-out',
        'glow-pulse':   'glowPulse 4s ease-in-out infinite',
        'mesh-drift':   'meshDrift 12s ease-in-out infinite alternate',
        'shimmer':      'shimmer 1.8s linear infinite',
        'spin-slow':    'spin 3s linear infinite',
        'scale-in':     'scaleIn 0.15s ease-out',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-6px) scale(0.97)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.3' },
          '50%':      { opacity: '0.6' },
        },
        meshDrift: {
          '0%':   { transform: 'translate(0,0) scale(1)' },
          '100%': { transform: 'translate(-4%,-4%) scale(1.08)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backgroundImage: {
        'mesh-violet': [
          'radial-gradient(at 20% 30%,  rgba(124,110,243,0.18) 0px, transparent 55%)',
          'radial-gradient(at 80% 10%,  rgba(99,102,241,0.12)  0px, transparent 50%)',
          'radial-gradient(at 5%  80%,  rgba(139,92,246,0.12)  0px, transparent 50%)',
          'radial-gradient(at 90% 80%,  rgba(79,70,229,0.08)   0px, transparent 50%)',
        ].join(', '),
      },
      boxShadow: {
        card:         '0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
        'card-hover': '0 4px 20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.09)',
        primary:      '0 0 24px rgba(124,110,243,0.35)',
        'primary-sm': '0 0 14px rgba(124,110,243,0.25)',
        'inner-top':  'inset 0 1px 0 rgba(255,255,255,0.07)',
        glow:         '0 0 40px rgba(124,110,243,0.15)',
      },
    },
  },
  plugins: [],
};

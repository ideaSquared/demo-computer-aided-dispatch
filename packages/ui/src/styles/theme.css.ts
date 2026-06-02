import { createTheme, createThemeContract } from '@vanilla-extract/css';

/**
 * The token contract. Every token is declared here so consuming code can
 * reference `vars.<category>.<key>` with type safety, regardless of which
 * theme is active. Themes (light / normal / dark) are mappings of these
 * contract keys to concrete values.
 */
export const vars = createThemeContract({
  colors: {
    brand: {
      primary: null,
      primaryHover: null,
    },
    surface: {
      bg: null,
      bgElevated: null,
      border: null,
    },
    text: {
      default: null,
      subtle: null,
      onBrand: null,
      onDanger: null,
    },
    intent: {
      danger: null,
      warning: null,
      success: null,
    },
  },
  spacing: {
    '0': null,
    '2': null,
    '4': null,
    '8': null,
    '12': null,
    '16': null,
    '24': null,
    '32': null,
    '48': null,
    '64': null,
  },
  radii: {
    sm: null,
    md: null,
    lg: null,
    full: null,
  },
  typography: {
    body: null,
    heading: {
      sm: null,
      md: null,
      lg: null,
    },
    mono: null,
  },
  shadows: {
    sm: null,
    md: null,
    elevated: null,
    focusRing: null,
  },
  transitions: {
    fast: null,
    spring: null,
  },
  zIndex: {
    base: null,
    sticky: null,
    modal: null,
    toast: null,
  },
});

const baseTokens = {
  spacing: {
    '0': '0',
    '2': '2px',
    '4': '4px',
    '8': '8px',
    '12': '12px',
    '16': '16px',
    '24': '24px',
    '32': '32px',
    '48': '48px',
    '64': '64px',
  },
  radii: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },
  typography: {
    body: '14px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    heading: {
      sm: '600 16px/1.4 -apple-system, BlinkMacSystemFont, "Inter", sans-serif',
      md: '600 20px/1.3 -apple-system, BlinkMacSystemFont, "Inter", sans-serif',
      lg: '700 28px/1.2 -apple-system, BlinkMacSystemFont, "Inter", sans-serif',
    },
    mono: '13px/1.5 "JetBrains Mono", "SF Mono", Menlo, monospace',
  },
  transitions: {
    fast: '120ms ease-out',
    spring: '180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
  zIndex: {
    base: '0',
    sticky: '100',
    modal: '1000',
    toast: '2000',
  },
};

export const lightTheme = createTheme(vars, {
  ...baseTokens,
  colors: {
    brand: {
      primary: '#0a84ff',
      primaryHover: '#0066cc',
    },
    surface: {
      bg: '#ffffff',
      bgElevated: '#f7f9fc',
      border: '#e4e8ee',
    },
    text: {
      default: '#0d1117',
      subtle: '#57606a',
      onBrand: '#ffffff',
      onDanger: '#ffffff',
    },
    intent: {
      danger: '#cf222e',
      warning: '#bf8700',
      success: '#1a7f37',
    },
  },
  shadows: {
    sm: '0 1px 2px rgba(13, 17, 23, 0.06)',
    md: '0 4px 8px rgba(13, 17, 23, 0.08)',
    elevated: '0 8px 24px rgba(13, 17, 23, 0.12)',
    focusRing: '0 0 0 3px rgba(10, 132, 255, 0.4)',
  },
});

export const normalTheme = createTheme(vars, {
  ...baseTokens,
  colors: {
    brand: {
      primary: '#2563eb',
      primaryHover: '#1d4ed8',
    },
    surface: {
      bg: '#f9fafb',
      bgElevated: '#ffffff',
      border: '#e5e7eb',
    },
    text: {
      default: '#111827',
      subtle: '#4b5563',
      onBrand: '#ffffff',
      onDanger: '#ffffff',
    },
    intent: {
      danger: '#dc2626',
      warning: '#d97706',
      success: '#16a34a',
    },
  },
  shadows: {
    sm: '0 1px 2px rgba(17, 24, 39, 0.06)',
    md: '0 4px 8px rgba(17, 24, 39, 0.08)',
    elevated: '0 8px 24px rgba(17, 24, 39, 0.12)',
    focusRing: '0 0 0 3px rgba(37, 99, 235, 0.4)',
  },
});

export const darkTheme = createTheme(vars, {
  ...baseTokens,
  colors: {
    brand: {
      primary: '#3b82f6',
      primaryHover: '#60a5fa',
    },
    surface: {
      bg: '#0d1117',
      bgElevated: '#161b22',
      border: '#30363d',
    },
    text: {
      default: '#f0f6fc',
      subtle: '#8b949e',
      onBrand: '#ffffff',
      onDanger: '#ffffff',
    },
    intent: {
      danger: '#f85149',
      warning: '#d29922',
      success: '#3fb950',
    },
  },
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.4)',
    md: '0 4px 8px rgba(0, 0, 0, 0.4)',
    elevated: '0 8px 24px rgba(0, 0, 0, 0.5)',
    focusRing: '0 0 0 3px rgba(59, 130, 246, 0.5)',
  },
});

// Apps apply one of the theme classes (lightTheme / normalTheme / darkTheme)
// to the root element. Switching themes is a className swap — vars resolve
// transparently because they're contract references.

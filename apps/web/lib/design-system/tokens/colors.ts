/**
 * Color System - Free Open Talk Design Tokens
 *
 * Warm dark theme with orange/amber accents.
 * Mirrors the CSS custom properties in app/globals.css — token names stay
 * the same (bg-primary-500 etc.), they now resolve to the warm palette.
 */

export const colors = {
    // Primary - Warm orange accent (signature color)
    primary: {
        50: '#fff7ed',
        100: '#ffedd5',
        200: '#fed7aa',
        300: '#fdba74',
        400: '#fb923c',
        500: '#f97316', // Main primary
        600: '#ea580c',
        700: '#c2410c',
        800: '#9a3412',
        900: '#7c2d12',
        950: '#431407',
    },

    // Secondary - Amber for depth
    secondary: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        300: '#fcd34d',
        400: '#fbbf24',
        500: '#f59e0b',
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
        950: '#451a03',
    },

    // Background colors - Warm dark theme
    background: {
        primary: '#14100c',      // Deepest background
        secondary: '#1a1410',    // Card backgrounds
        tertiary: '#221a12',     // Elevated elements
        elevated: '#2a2015',     // Hover states, inputs
        overlay: 'rgba(0, 0, 0, 0.7)', // Modal overlays
    },

    // Surface colors for cards and containers
    surface: {
        default: '#211a13',
        hover: '#2a2117',
        active: '#332920',
        border: '#3a2d1e',
        borderSubtle: '#2c2318',
    },

    // Text colors
    text: {
        primary: '#faf5ed',      // Main text
        secondary: '#c9bda9',    // Muted text
        tertiary: '#8a7d68',     // Disabled/placeholder
        inverse: '#14100c',      // Text on light bg
        accent: '#fdba74',       // Highlighted text
    },

    // Status colors
    status: {
        success: '#4ade80',
        successMuted: '#166534',
        warning: '#f59e0b',
        warningMuted: '#92400e',
        error: '#f87171',
        errorMuted: '#7f1d1d',
        info: '#fbbf24',
        infoMuted: '#92400e',
    },

    // Voice/Audio specific
    voice: {
        speaking: '#f59e0b',     // Active speaking indicator (amber)
        speakingGlow: 'rgba(245, 158, 11, 0.4)',
        muted: '#f87171',
        mutedGlow: 'rgba(248, 113, 113, 0.3)',
        idle: '#8a7d68',
    },

    // Interactive states
    interactive: {
        hover: 'rgba(249, 115, 22, 0.1)',
        active: 'rgba(249, 115, 22, 0.2)',
        focus: 'rgba(249, 115, 22, 0.4)',
    },

    // Language badges - Warm tints so every language reads as its own
    // shade of the theme instead of clashing cool colors
    language: {
        english: '#fb923c',
        spanish: '#f59e0b',
        french: '#fdba74',
        german: '#fbbf24',
        japanese: '#f87171',
        korean: '#f97316',
        chinese: '#ea580c',
        portuguese: '#fcd34d',
        russian: '#d97706',
        arabic: '#fde68a',
        default: '#f97316',
    },

    // Gradients
    gradient: {
        primary: 'linear-gradient(135deg, #f97316 0%, #f59e0b 100%)',
        secondary: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
        surface: 'linear-gradient(180deg, rgba(249, 115, 22, 0.1) 0%, transparent 100%)',
        glow: 'radial-gradient(circle, rgba(249, 115, 22, 0.2) 0%, transparent 70%)',
        card: 'linear-gradient(135deg, rgba(249, 115, 22, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)',
    },
} as const;

// CSS Variables mapping for Tailwind
export const cssVariables = {
    '--color-primary': colors.primary[500],
    '--color-primary-hover': colors.primary[400],
    '--color-primary-active': colors.primary[600],

    '--color-background': colors.background.primary,
    '--color-background-secondary': colors.background.secondary,
    '--color-background-tertiary': colors.background.tertiary,

    '--color-surface': colors.surface.default,
    '--color-surface-hover': colors.surface.hover,
    '--color-surface-border': colors.surface.border,

    '--color-text-primary': colors.text.primary,
    '--color-text-secondary': colors.text.secondary,
    '--color-text-tertiary': colors.text.tertiary,

    '--color-success': colors.status.success,
    '--color-warning': colors.status.warning,
    '--color-error': colors.status.error,
    '--color-info': colors.status.info,
} as const;

export type ColorToken = typeof colors;
export type PrimaryColor = keyof typeof colors.primary;

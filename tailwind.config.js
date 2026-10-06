/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			// self-hosted via @fontsource (src/main.jsx), so no request to Google
  			sans: ['"Space Grotesk Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			// Code A Difference's ember. The app used indigo/violet/fuchsia everywhere; the same
  			// class names now resolve to the site's orange, so no purple is left anywhere.
  			indigo: {
  			50: '#fff4ee', 100: '#ffe4d6', 200: '#ffc9ad', 300: '#ffa57a', 400: '#ff8556',
  			500: '#ff6b3d', 600: '#cf4519', 700: '#a5380f', 800: '#842f12', 900: '#6c2a13', 950: '#3a1307',
  		},
  			violet: {
  			50: '#fff4ee', 100: '#ffe4d6', 200: '#ffc9ad', 300: '#ffa57a', 400: '#ff8556',
  			500: '#ff6b3d', 600: '#cf4519', 700: '#a5380f', 800: '#842f12', 900: '#6c2a13', 950: '#3a1307',
  		},
  			purple: {
  			50: '#fff4ee', 100: '#ffe4d6', 200: '#ffc9ad', 300: '#ffa57a', 400: '#ff8556',
  			500: '#ff6b3d', 600: '#cf4519', 700: '#a5380f', 800: '#842f12', 900: '#6c2a13', 950: '#3a1307',
  		},
  			fuchsia: {
  			50: '#fff4ee', 100: '#ffe4d6', 200: '#ffc9ad', 300: '#ffa57a', 400: '#ff8556',
  			500: '#ff6b3d', 600: '#cf4519', 700: '#a5380f', 800: '#842f12', 900: '#6c2a13', 950: '#3a1307',
  		},
  			mint: '#4fd6c4',
  			// Code A Difference's ink scale instead of Tailwind's blue-grey slate
  			slate: {
  				50: '#f6f3ec', 100: '#ece8df', 200: '#d9d4c8', 300: '#b9b6ae', 400: '#8a8d99', 500: '#6b6f7d',
  				600: '#4d505c', 700: '#2f323d', 800: '#161922', 900: '#101219', 950: '#0a0b0f',
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
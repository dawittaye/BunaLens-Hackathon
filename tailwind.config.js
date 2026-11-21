module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './contexts/**/*.{js,jsx,ts,tsx}', './constants/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        espresso: '#26372D',
        cherry: '#A34F3E',
        emerald: '#55765D',
        harvest: '#B7834D',
        parchment: '#F5F6EF',
        surface: '#FFFFFF',
        line: '#E5E9E0',
        secondary: '#727C70',
        muted: '#A3AA9F',
        'cherry-soft': '#F7EAE5',
        'emerald-soft': '#EAF1E8',
        'harvest-soft': '#F6EFE3',
      },
      borderRadius: { '3xl': '1.5rem', '4xl': '2rem' },
      boxShadow: {
        card: '0 5px 18px rgba(38, 55, 45, 0.045)',
        lift: '0 10px 26px rgba(38, 55, 45, 0.08)',
      },
    },
  },
  plugins: [],
};

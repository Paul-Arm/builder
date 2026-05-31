export default defineNuxtConfig({
  compatibilityDate: '2026-05-31',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ui: {
    colorMode: false,
    theme: {
      colors: [
        'primary',
        'secondary',
        'success',
        'info',
        'warning',
        'error',
        'neutral'
      ]
    }
  },
  runtimeConfig: {
    surreal: {
      url: process.env.SURREALDB_URL || '',
      namespace: process.env.SURREALDB_NAMESPACE || 'builder',
      database: process.env.SURREALDB_DATABASE || 'inventory',
      username: process.env.SURREALDB_USERNAME || '',
      password: process.env.SURREALDB_PASSWORD || ''
    },
    public: {
      appName: 'Builder'
    }
  }
})

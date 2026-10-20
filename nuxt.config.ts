// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    modules: ['@nuxt/ui'],
    css: ['~/assets/css/main.css'],
    devtools: {enabled: true},
    nitro: {
        experimental: {
            tasks: true,
            database: true
        },
        database: {
            default: {connector: 'sqlite', options: {name: 'app'}} // .data/app.sqlite3
        }
    },
    runtimeConfig: {
        contentRoot: '',
    }
})

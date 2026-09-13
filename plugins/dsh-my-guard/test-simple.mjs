import { createStore } from './lib/store.js'

const store = createStore(
  {},
  {
    readFile: async () =>
      JSON.stringify({
        version: 1,
        alerts: [{ id: 5, time: 1700000000000, confirmed: false, type: 'test', message: 'test' }],
      }),
  },
)

await store.whenReady()

const alert = store.record({ type: 'test', message: 'test alert' })
console.log('alert id:', alert.id)
console.log('expected id > 5:', alert.id > 5)

store.dispose()

import { createStore } from './lib/store.js'

// 设置环境变量
process.env.DSH_HOME = '/tmp/test-home'

const store = createStore(
  {},
  {
    readFile: async (filePath) => {
      console.log('[TEST] readFile called with:', filePath)
      return JSON.stringify({
        version: 1,
        alerts: [{ id: 5, time: 1700000000000, confirmed: false, type: 'test', message: 'test' }],
      })
    },
  },
)

await store.whenReady()

const alert = store.record({ type: 'test', message: 'test alert' })
console.log('alert id:', alert.id)
console.log('expected id > 5:', alert.id > 5)

store.dispose()

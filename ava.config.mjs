// import { existsSync, readFileSync, rmSync } from 'node:fs'
// import { resolve } from 'node:path'

// // tsimp compiles through a background daemon (sock-daemon). That client
// // restarts the daemon only when the socket is missing (ENOENT). If the
// // daemon is killed, the socket file stays, connect fails with
// // ECONNREFUSED, and the request never settles — AVA then sits until
// // timeout with no test registered ("Failed to exit").
// function dropStaleTsimpSocket() {
//   const socket = resolve('.tsimp/daemon/socket')
//   if (!existsSync(socket))
//     return
//   let alive = false
//   try {
//     const pid = Number(readFileSync(resolve('.tsimp/daemon/pid'), 'utf8'))
//     if (Number.isInteger(pid) && pid > 0) {
//       process.kill(pid, 0)
//       alive = true
//     }
//   }
//   catch (error) {
//     alive = error?.code === 'EPERM'
//   }
//   if (!alive)
//     rmSync(socket, { force: true })
// }

// dropStaleTsimpSocket()

export default {
  verbose: true,
  extensions: ['ts'],
  nodeArguments: [
    '--import=tsimp',
    '--no-warnings'
  ],
  files: ['test/**/*.test.ts'],
  timeout: '20s',
  environmentVariables: {
    TSIMP_DIAG: 'ignore',
  }
}

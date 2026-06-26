Run `npm audit` for details.
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ npm run dev

> tangu-agent-desktop@1.1.0 dev
> node scripts/ensure-electron-sqlite.mjs && electron-vite dev --noSandbox

node:internal/modules/cjs/loader:1404
  throw err;
  ^

Error: Cannot find module '/home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/scripts/ensure-electron-sqlite.mjs'
    at Function._resolveFilename (node:internal/modules/cjs/loader:1401:15)
    at defaultResolveImpl (node:internal/modules/cjs/loader:1057:19)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1062:22)
    at Function._load (node:internal/modules/cjs/loader:1211:37)
    at TracingChannel.traceSync (node:diagnostics_channel:322:14)
    at wrapModuleLoad (node:internal/modules/cjs/loader:235:24)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:170:5)
    at node:internal/main/run_main_module:36:49 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ npm run dev

> tangu-agent-desktop@1.1.0 dev
> electron-vite dev

vite v7.3.5 building ssr environment for development...
✓ 230 modules transformed.
node_modules/gray-matter/lib/engines.js (43:13): Use of eval in "node_modules/gray-matter/lib/engines.js" is strongly discouraged as it poses security risks and may cause issues with minification.
node_modules/@iarna/toml/lib/toml-parser.js (178:22): Use of eval in "node_modules/@iarna/toml/lib/toml-parser.js" is strongly discouraged as it poses security risks and may cause issues with minification.
out/main/main.js  477.29 kB
✓ built in 1.62s

electron main process built successfully

-----

vite v7.3.5 building ssr environment for development...
✓ 1 modules transformed.
out/preload/preload.mjs  4.09 kB
✓ built in 24ms

electron preload scripts built successfully

-----

dev server running for the electron renderer process at:

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose

starting electron app...

[686248:0618/154242.464745:FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now. You need to make sure that /home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/electron/dist/chrome-sandbox is owned by root and has mode 4755.
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ sudo npm run dev
[sudo] password for skyler: 

> tangu-agent-desktop@1.1.0 dev
> electron-vite dev

vite v7.3.5 building ssr environment for development...
✓ 230 modules transformed.
node_modules/gray-matter/lib/engines.js (43:13): Use of eval in "node_modules/gray-matter/lib/engines.js" is strongly discouraged as it poses security risks and may cause issues with minification.
node_modules/@iarna/toml/lib/toml-parser.js (178:22): Use of eval in "node_modules/@iarna/toml/lib/toml-parser.js" is strongly discouraged as it poses security risks and may cause issues with minification.
out/main/main.js  477.29 kB
✓ built in 2.06s

electron main process built successfully

-----

vite v7.3.5 building ssr environment for development...
✓ 1 modules transformed.
out/preload/preload.mjs  4.09 kB
✓ built in 38ms

electron preload scripts built successfully

-----

error during start dev server and electron app:
TypeError: crypto.hash is not a function
    at getHash (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:2444:19)
    at getLockfileHash (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:32463:9)
    at getDepHash (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:32466:23)
    at initDepsOptimizerMetadata (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:31925:53)
    at createDepsOptimizer (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:34113:17)
    at new DevEnvironment (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:34893:109)
    at Object.defaultCreateClientDevEnvironment [as createEnvironment] (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:35305:9)
    at file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:25469:52
    at Array.map (<anonymous>)
    at _createServer (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/dist/node/chunks/config.js:25468:58)
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ starting electron app...

[681589:0618/153126.372787:FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now. You need to make sure that /home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/electron/dist/chrome-sandbox is owned by root and has mode 4755.
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ 
^C
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ npm run dev

> tangu-agent-desktop@1.1.0 dev
> electron-vite dev

vite v7.3.5 building ssr environment for development...
✓ 230 modules transformed.
node_modules/gray-matter/lib/engines.js (43:13): Use of eval in "node_modules/gray-matter/lib/engines.js" is strongly discouraged as it poses security risks and may cause issues with minification.
node_modules/@iarna/toml/lib/toml-parser.js (178:22): Use of eval in "node_modules/@iarna/toml/lib/toml-parser.js" is strongly discouraged as it poses security risks and may cause issues with minification.
out/main/main.js  477.29 kB
✓ built in 1.62s

electron main process built successfully

-----

vite v7.3.5 building ssr environment for development...
✓ 1 modules transformed.
out/preload/preload.mjs  4.09 kB
✓ built in 24ms

electron preload scripts built successfully

-----

dev server running for the electron renderer process at:

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose

starting electron app...

[686248:0618/154242.464745:FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now. You need to make sure that /home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/electron/dist/chrome-sandbox is owned by root and has mode 4755.
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ sudo npm run dev
[sudo] password for skyler: 

> tangu-agent-desktop@1.1.0 dev
> electron-vite dev

    at _createServer (file:///home/skyler/Documents/Projects/Forsion/apps/Tangu-Agent/desktop/node_modules/vite/d^Config.js:25469:52ent/desktop/node_modules/vite/
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ ^C
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ ^C
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ ^C
skyler@skyler-VMware-Virtual-Platform:~/Documents/Projects/Forsion/apps/Tangu-Agent/desktop$ 

const shell = require('shelljs')

// 复制预设的问题答案，创建项目并尝试构建要求无error
shell.cp('testfile/wx-dll-cross-meta.js', './meta.js').code !== 0 && shell.exit(1)
shell.exec('mpx init demo-dll-cross --offline .').code !== 0 && shell.exit(1)
shell.exec('cd demo-dll-cross && npm i && npm run build:dll && npm run build:dev --wx --ali').code !== 0 && shell.exit(1)

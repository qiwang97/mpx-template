const ora = require('ora')
const rm = require('rimraf')
const path = require('path')
const chalk = require('chalk')
const webpack = require('webpack')
const merge = require('webpack-merge')
const program = require('commander')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const MpxWebpackPlugin = require('@mpxjs/webpack-plugin')
const mpxWebpackPluginConfig = require('../config/mpx.conf')
const getConfig = require('../config/index')
const webpackMainConfig = require('./webpack.conf')

let getDllManifests
let dllManifests

program
  .option('-w, --watch', 'watch mode')
  .option('-p, --production', 'production release')
  .parse(process.argv)

const config = getConfig(program.production)
if (config.needDll) {
  getDllManifests = require('./getDllManifests')
  dllManifests = getDllManifests(program.production)
}
const mainSubDir = (config.isPlugin === 'true' || config.cloudFunc === 'true') ? 'miniprogram' : ''

function resolveDist (platform, subPathStr = mainSubDir) {
  return path.resolve(__dirname, '../dist', platform, subPathStr, '')
}
function resolve (file) {
  return path.resolve(__dirname, '..', file || '')
}

const mpxLoaderConfig = config.mpxLoaderConfig

const webpackConfigArr = []
const userSelectedMode = 'wx'

if (config.isPlugin === 'true') {
  webpackConfigArr.push(require('./webpack.plugin.conf'))
}

// 支持的平台，若后续@mpxjs/webpack-plugin支持了更多平台，补充在此即可
const supportedCrossMode = config.supportedModes
// 提供npm argv找到期望构建的平台，必须在上面支持的平台列表里
const npmConfigArgvOriginal = (process.env.npm_config_argv && JSON.parse(process.env.npm_config_argv).original) || []
const modeArr = npmConfigArgvOriginal.filter(item => typeof item === 'string').map(item => item.replace('--', '')).filter(item => supportedCrossMode.includes(item))

if (modeArr.length === 0) modeArr.push(userSelectedMode)

// 根据目标平台生成最终的webpack配置并推入webpackConfigArr数组
const generateWebpackConfig = (item, index, arr) => {
  const plugins = [
    new MpxWebpackPlugin(Object.assign({
      mode: item,
      srcMode: userSelectedMode
    }, mpxWebpackPluginConfig))
  ]
  const copyList = [{
    context: resolve(`static/${item}`),
    from: '**/*',
    to: (mainSubDir || config.cloudFunc === 'true') ? '..' : ''
  }]

  if (config.cloudFunc === 'true') {
    copyList.push({
      context: resolve(`src/functions`),
      from: '**/*',
      to: '../functions/'
    })
  }

  if (config.needDll) {
    const localDllManifests = dllManifests.filter((manifest) => {
      return manifest.mode === item || !manifest.mode
    })

    localDllManifests.forEach((manifest) => {
      plugins.push(new webpack.DllReferencePlugin({
        context: config.context,
        manifest: manifest.content
      }))
      copyList.push({
        context: path.join(config.dllPath, 'lib'),
        from: manifest.content.name,
        to: manifest.content.name
      })
    })
  }
  plugins.push(new CopyWebpackPlugin(copyList))

  const mpxLoaderRule = (config.transWeb && item === 'web') ? {
    test: /\.mpx$/,
    use: [
      {
        loader: 'vue-loader',
        options: {
          transformToRequire: {
            'mpx-image': 'src',
            'mpx-audio': 'src',
            'mpx-video': 'src'
          }
        }
      },
      MpxWebpackPlugin.loader(mpxLoaderConfig)
    ]
  } : {
    test: /\.mpx$/,
    use: MpxWebpackPlugin.loader(mpxLoaderConfig)
  }

  const extendRules = (config.transWeb && item === 'web') ? [
    {
      test: /\.vue$/,
      loader: 'vue-loader'
    },
    mpxLoaderRule,
    {
      test: /\.styl$/,
      use: [
        'style-loader',
        'css-loader',
        'stylus-loader'
      ]
    }
  ] : [mpxLoaderRule]

  const webpackCrossConfig = merge(webpackMainConfig, {
    name: item + '-compiler',
    output: {
      path: resolveDist(item)
    },
    module: { rules: extendRules },
    plugins
  }, item === 'web' ? {
    optimization: {
      usedExports: true,
      sideEffects: true,
      providedExports: true
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: 'index.html',
        template: resolve('src/index.html'),
        inject: true
      })
    ]
  } : undefined)
  webpackConfigArr.push(webpackCrossConfig)
}

modeArr.forEach(generateWebpackConfig)

function runWebpack (cfg) {
  // env
  if (Array.isArray(cfg)) {
    cfg.forEach(item => item.plugins.unshift(new webpack.DefinePlugin(config.env)))
  } else {
    cfg.plugins.unshift(new webpack.DefinePlugin(config.env))
  }

  // production mode set mode be 'production' for webpack
  // watch mode set cache be true for webpack
  if (program.production || program.watch) {
    const extendCfg = {}
    if (program.production) { extendCfg.mode = 'production' }
    if (program.watch){ extendCfg.cache = true }

    if (Array.isArray(cfg)) {
      cfg = cfg.map(item => merge(item, extendCfg))
    } else {
      cfg = merge(cfg, extendCfg)
    }
  }
  if (process.env.npm_config_report) {
    const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
    const mainCfg = Array.isArray(cfg) ? cfg[0] : cfg
    mainCfg.plugins.push(new BundleAnalyzerPlugin())
  }
  if (program.watch) {
    webpack(cfg).watch({}, callback)
  } else {
    webpack(cfg, callback)
  }
}

function callback (err, stats) {
  spinner.stop()
  if (err) {
    if (process.env.CI) {
      process.exitCode = 1
    }
    return console.error(err)
  }

  process.stdout.write(stats.toString({
    colors: true,
    modules: false,
    children: false,
    chunks: false,
    chunkModules: false,
    entrypoints: false
  }) + '\n\n')

  if (!program.watch && stats.hasErrors()) {
    console.log(chalk.red('  Build failed with errors.\n'))
    if (process.env.CI) {
      process.exitCode = 1
    }
  }

  console.log(chalk.cyan('  Build complete.\n'))
  if (program.watch) {
    console.log(chalk.cyan(`  ${new Date()} build finished.\n  Still watching...\n`))
  }
}

const spinner = ora('building...')
spinner.start()

try {
  modeArr.forEach(item => {
    rm.sync(path.resolve(__dirname, `../dist/${item}/*`))
  })
} catch (e) {
  console.error(e)
  console.log('\n\n删除dist文件夹遇到了一些问题，如果遇到问题请手工删除dist重来\n\n')
}

if (webpackConfigArr.length === 1) {
  runWebpack(webpackConfigArr[0])
} else {
  runWebpack(webpackConfigArr)
}

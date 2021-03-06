#!/usr/bin/env node

/**
 * @name bump
 * @author 机智的小鱼君 <dragon-fish@qq.com>
 *
 * @license Apache-2.0
 */

// 导入依赖
const axios = require('axios')
const { exec, execSync } = require('child_process')
const { program } = require('commander')
const fs = require('fs-extra')
const path = require('path')
const { version: localVer, name: pkgName } = fs.readJSONSync(path.resolve('./package.json'))

// 定义选项
program
  .description('快捷发包命令行工具，一键更新版本号并推送')
  // .addHelpText('bump --dry -3 --msg "chore: new patch"')
  .version(
    require('./package.json').name + ' v' + require('./package.json').version,
    '-v, --version',
    '显示 bump CLI 的版本'
  )
  .option(
    '-c, --check',
    '查看 ' + pkgName + ' 目前的版本号'
  )
  .option('-1, --major [type]', '提升主版本号 (type只能是alpha或者数字)')
  .option('-2, --minor [type]', '提升次版本号 (type只能是alpha或者数字)')
  .option('-3, --patch [type]', '提交补丁 (type只能是alpha或者数字)')
  .option('-4, --pre [type]', '提交新的预发布版本 (type可以是alpha/beta/rc)')
  .option(
    '--tag [tag]',
    '自定义发布的 npm tag (预设为 latest，发布 pre 版本时为 next)'
  )
  .option('--nopkg', '若定义，则不修改 package.json')
  .option('--nopush', '若定义，则不推送到远程仓库')
  .option('--nopublish', '若定义，则不推送 npm 包')
  .option('-m, --msg <msg>', '编辑摘要 (预设为 "chore: bump version")')
  .option('--registry <registry>', '指定 npm 的仓库地址')
  .option('-d, --dry', '空运行，测试指令，不作出真正的修改')

async function getPackVersions() {
  const { data: origin } = await axios.get('https://registry.npmjs.org/' + pkgName)
  return { local: localVer, ...origin['dist-tags'] }
}

function parseVersion(version) {
  version = version || localVer
  const basic = version.split('-')[0]
  const [major, minor, patch] = basic.split('.')
  const pre = { type: null, value: null }
  if (version.split('-')[1]) {
    let [type, value] = version.split('-')[1].split('.')
    pre.type = type
    pre.value = parseInt(value)
  }
  return {
    major: parseInt(major),
    minor: parseInt(minor),
    patch: parseInt(patch),
    pre,
    raw: version,
  }
}

function generateVersion(version) {
  let str = `${version.major || 0}.${version.minor || 0}.${version.patch || 0}`
  if (version.pre.type !== null) {
    str += `-${version.pre.type}.${version.pre.value || 0}`
  }
  return str
}

function bumpMajor(type, version) {
  version = parseVersion(version)
  const currentMajor = version.major
  version.major += 1
  version.minor = 0
  version.patch = 0
  version.pre.type = null

  // 是否以alpha版发布
  if (type === 'alpha' || type === 'a') {
    version.pre.type = 'alpha'
    version.pre.value = 0
  }
  // 是否指定版本
  if (!isNaN(parseInt(type))) {
    type = parseInt(type)
    if (type < currentMajor) throw '不能降级'
    version.major = type
  }
  // 是否是pre版正式发布
  if (version.pre.type !== null) {
    version.pre.patch = null
    version.pre.value = null
    return version
  }

  return version
}

function bumpMinor(type, version) {
  version = parseVersion(version)
  const currentMinor = version.minor
  version.minor += 1
  version.patch = 0
  version.pre.type = null

  // 是否以alpha版发布
  if (type === 'alpha' || type === 'a') {
    version.pre.type = 'alpha'
    version.pre.value = 0
  }
  // 是否指定版本
  if (!isNaN(parseInt(type))) {
    type = parseInt(type)
    if (type < currentMinor) throw '不能降级'
    version.minor = type
  }
  // 是否是pre版正式发布
  if (version.pre.type !== null) {
    version.pre.patch = null
    version.pre.value = null
    return version
  }

  return version
}

function bumpPatch(type, version) {
  version = parseVersion(version)
  const currentPatch = version.path

  version.patch += 1
  version.pre.type = null

  // 是否以alpha版发布
  if (type === 'alpha' || type === 'a') {
    version.pre.type = 'alpha'
    version.pre.value = 0
  }
  // 是否指定版本
  if (!isNaN(parseInt(type))) {
    type = parseInt(type)
    if (type < currentPatch) throw '不能降级'
    version.patch = type
  }
  // 是否是pre版正式发布
  if (version.pre.type !== null) {
    version.pre.patch = null
    version.pre.value = null
    return version
  }

  return version
}

function bumpPre(type, version) {
  version = parseVersion(version)
  const currentType = version.pre.type

  // 升级到下一个patch的alpha
  if (type === true && currentType === null) {
    return bumpPatch('alpha')
  }

  // 检查alpha
  if (type === 'alpha' || type === 'a') {
    if (currentType === 'beta' || currentType === 'rc') throw '不能降级'
    if (currentType !== 'alpha') return bumpPatch('alpha')
    version.pre.type = 'alpha'
    version.pre.value += 1
  }

  // 检查beta
  else if (type === 'beta' || type === 'b') {
    if (currentType === 'rc') throw '不能降级'
    if (currentType !== 'beta') version.pre.value = -1
    version.pre.type = 'beta'
    version.pre.value += 1
  }

  // 检查rc
  else if (type === 'rc' || type === 'pre' || type === 'r') {
    if (currentType !== 'rc') version.pre.value = -1
    version.pre.type = 'rc'
    version.pre.value += 1
  }

  // 没有指定
  else if (type === true) {
    version.pre.value += 1
  }

  // 不支持的版本
  else {
    throw new Error('不支持的版本名：' + type)
  }

  return version
}

function runCmd(arr, line = 0, { dry, nopush, nopublish }) {
  const cmd = arr[line]
  if (!cmd) return

  if (
    !(nopush && cmd.startsWith('git push')) &&
    !(nopublish && cmd.startsWith('npm publish'))
  ) {
    console.log(`执行指令${dry ? '(dry)' : ''}`, cmd)
    if (!dry) {
      try {
        let res = execSync(cmd)
        if (res && res.toString()) {
          console.log(res.toString())
        }
      } catch (err) {
        console.error('× 执行命令时出现问题：', cmd)
        throw err
      }
    }
  }

  if (arr[line + 1]) runCmd(arr, line + 1, { dry, nopush, nopublish })
}

async function Main(args) {
  program.parse(args)
  const options = program.opts()

  // 查看目前的版本号
  if (options.check) {
    console.log('目前版本', await getPackVersions())
    return
  }

  console.log('输入选项', options)

  // 处理版本号
  let newVer = ''

  if (options.pre) {
    newVer = generateVersion(bumpPre(options.pre))
  } else if (options.patch) {
    newVer = generateVersion(bumpPatch(options.patch))
  } else if (options.minor) {
    newVer = generateVersion(bumpMinor(options.minor))
  } else if (options.major) {
    newVer = generateVersion(bumpMajor(options.major))
  } else {
    console.info('[INFO] 未指定版本，尝试自动获取新版本号……')
    let verNum = localVer
    verNum = verNum.split('.')
    let last = parseInt(verNum[verNum.length - 1])
    if (isNaN(last)) throw '× 获取新版本号时遇到问题。'
    verNum[verNum.length - 1] = last + 1
    newVer = verNum.join('.')
  }

  // 处理摘要
  let msg = options.msg
  if (typeof msg !== 'string') {
    msg = 'chore: bump version'
  }
  msg = msg.trim()
  msg += ` (bump version: ${newVer})`
  msg = msg.trim()

  // 处理是否为 测试版
  let tag = 'latest'
  if (newVer.includes('-')) tag = 'next'
  if (typeof options.tag === 'string') tag = options.tag

  const shellCmd = [
    'git add .',
    `git commit -a -m "${msg}"`,
    `git tag -a "${newVer}" -m "${msg}"`,
    `git push`,
    `git push --tag`,
    `npm publish --tag "${tag}" --registry ${options.registry ||
      'https://registry.npmjs.org/'}`,
  ]

  if (options.dry) {
    console.info('[INFO] 空运行模式，不会修改 package.json 或实际提交')
    console.log('目前版本', localVer)
    console.log('提交版本', newVer)
    console.log('修改摘要', msg)
    runCmd(shellCmd, 0, {
      dry: options.dry,
      nopublish: options.nopublish,
      nopush: options.nopush,
    })
    console.info('[INFO] 测试结束，请去除 --dry 选项来实际执行。')
    return
  }

  // 修改 package.json
  if (options.nopkg) {
    console.info('[INFO] 不修改 package.json')
  } else {
    const pkg = await fs.readJson(path.resolve('./package.json'))
    pkg.version = newVer
    const writeRes = await fs.writeFile(
      path.resolve('./package.json'),
      JSON.stringify(pkg, null, 2)
    )
    console.log(writeRes)
  }

  runCmd(shellCmd, 0, {
    dry: options.dry,
    nopublish: options.nopublish,
    nopush: options.nopush,
  })
  console.log('√ 新版本发布成功。')
}

try {
  Main(process.argv)
} catch (err) {
  console.error('× 更新版本失败！', err)
}

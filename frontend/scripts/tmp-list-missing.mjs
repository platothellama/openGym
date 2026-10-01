import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const localesDir = join(srcDir, 'locales')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (p === localesDir || name === 'instr' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

const CALL = /(^|[^A-Za-z0-9_$.])t\(\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/g
const used = new Map()
for (const file of walk(srcDir)) {
  for (const m of readFileSync(file, 'utf8').matchAll(CALL)) {
    const key = m[3].replace(/\\(['"\\])/g, '$1')
    if (!key) continue
    if (!used.has(key)) used.set(key, new Set())
    used.get(key).add(relative(root, file))
  }
}
const defined = new Set()
for (const f of readdirSync(localesDir).filter(x => x.endsWith('.js'))) {
  for (const k of Object.keys((await import(pathToFileURL(join(localesDir, f)).href)).default)) defined.add(k)
}
const missing = [...used.keys()].filter(k => !defined.has(k)).sort()
for (const key of missing) console.log(`${JSON.stringify(key)}\t${[...used.get(key)].sort().join(', ')}`)
console.log(`\n${missing.length} missing`)
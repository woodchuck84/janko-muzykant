import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const all = process.argv.includes('--all')
const paths = execFileSync('git', all ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const forbidden = /(?:^|\/)(?:data|node_modules|\.venv|\.gradle|\.tools|dist(?:-web|-android)?|recordings|test-results)(?:\/|$)|(?:\.apk|\.keystore|\.jks|\.pem|\.p12)$|(?:^|\/)\.env(?:\..*)?$|(?:^|\/)(?:local\.properties|google-services\.json|credentials\.json|client_secret[^/]*\.json)$/
const secrets = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}|ya29\.[0-9A-Za-z_-]{30,}|GOCSPX-[0-9A-Za-z_-]{15,}/
let failed = false
for (const path of paths) {
  const content = all ? readFileSync(path) : execFileSync('git', ['show', `:${path}`], { maxBuffer: 8 * 1024 * 1024 })
  if (forbidden.test(path) && path !== '.env.example' || content.byteLength > 5 * 1024 * 1024 || secrets.test(content.toString('utf8'))) {
    console.error(`Refusing publication: unsafe/oversized file ${path}`); failed = true
  }
}
if (failed) process.exit(1)
console.log(`Checked ${paths.length} ${all ? 'tracked' : 'staged'} files for excluded data, >5 MiB files and recognizable secret formats. Also review manually.`)

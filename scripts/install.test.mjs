import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const installer = resolve('website/install.sh');
function run({ clients = ['codex'], args = [], existing = false, failSkills = false, failAdd = false, outsideGit = false, oldNode = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sprinty-installer-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const log = join(dir, 'calls');
  const state = join(dir, 'registered');
  if (existing) writeFileSync(state, 'existing');
  const stub = (name, body) => writeFileSync(join(bin, name), '#!/bin/sh\nset -eu\n'+body+'\n', {mode:0o755});
  stub('node', `exit ${oldNode ? 1 : 0}`);
  stub('git', outsideGit ? 'exit 1' : 'printf "%s\\n" "$SPRINTY_TEST_PROJECT"');
  stub('npx', 'printf "npx %s\\n" "$*" >> "$SPRINTY_TEST_LOG"\nexit '+(failSkills ? 1 : 0));
  for (const client of clients) stub(client, `printf '${client} %s\\n' "$*" >> "$SPRINTY_TEST_LOG"
if [ "$2" = get ]; then [ -f "$SPRINTY_TEST_STATE" ]; exit; fi
[ "$2" = add ] || exit 9
${failAdd ? 'exit 1' : 'printf registered > "$SPRINTY_TEST_STATE"'}`);
  const result = spawnSync('/bin/sh', [installer, ...args], {cwd: dir, encoding:'utf8', env:{...process.env,PATH:bin,SPRINTY_TEST_PROJECT:dir,SPRINTY_TEST_LOG:log,SPRINTY_TEST_STATE:state}});
  const calls = existsSync(log) ? readFileSync(log,'utf8') : '';
  const registered = existsSync(state) ? readFileSync(state,'utf8') : null;
  rmSync(dir,{recursive:true,force:true});
  return {...result,calls,registered};
}
test('auto-detects Codex; installs both local skills and registers MCP',()=>{
  const r=run(); assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/npx --yes skills add ebursztein\/sprinty --skill how-to-run-a-sprint --skill using-sprinty --agent codex --yes/);
  assert.doesNotMatch(r.calls,/--global/);
  assert.match(r.calls,/codex mcp add sprinty -- npx -y sprinty-mcp@latest/);
  assert.equal(r.registered,'registered'); assert.match(r.stdout,/Restart/);
});
test('Claude uses local scope and correct skills agent',()=>{
  const r=run({clients:['claude']}); assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/--agent claude-code/); assert.match(r.calls,/claude mcp add --scope local --transport stdio sprinty/);
  assert.match(r.stdout,/identity hook/);
});
test('preserves existing server settings',()=>{
  const r=run({existing:true}); assert.equal(r.status,0,r.stderr);
  assert.doesNotMatch(r.calls,/mcp add/); assert.equal(r.registered,'existing');
});
test('selects explicit client when both are present',()=>{
  const r=run({clients:['codex','claude'],args:['--client','claude']}); assert.equal(r.status,0,r.stderr); assert.doesNotMatch(r.calls,/codex /);
});
test('requires choice when both are present without a terminal',()=>{
  const r=run({clients:['codex','claude']}); assert.notEqual(r.status,0); assert.match(r.stderr,/Both clients found/); assert.equal(r.calls,'');
});
test('skills failure stops before MCP mutation',()=>{
  const r=run({failSkills:true}); assert.notEqual(r.status,0); assert.doesNotMatch(r.calls,/mcp /); assert.equal(r.registered,null);
});
test('MCP failure does not claim setup succeeded',()=>{
  const r=run({failAdd:true}); assert.notEqual(r.status,0); assert.doesNotMatch(r.stdout,/Sprinty configured/);
});
for(const [name,options] of Object.entries({missingClient:{clients:[]},outsideGit:{outsideGit:true},oldNode:{oldNode:true},invalidClient:{args:['--client','other']},missingArgument:{args:['--client']},unknownFlag:{args:['--oops']}})) {
  test(`rejects ${name} before changes`,()=>{const r=run(options);assert.notEqual(r.status,0);assert.equal(r.calls,'');});
}
test('help has no side effects',()=>{const r=run({args:['--help']});assert.equal(r.status,0);assert.match(r.stdout,/Usage/);assert.equal(r.calls,'');});

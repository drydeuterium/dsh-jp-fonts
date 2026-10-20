#!/usr/bin/env node
/**
 * dsh-jp-fonts — make the dsh (DeepSeek Harness) web UI pick Japanese glyph shapes.
 *
 * The shipped font stacks name no Japanese family, so on a machine that has
 * Microsoft YaHei installed every kanji resolves to Simplified-Chinese shapes.
 * dsh already lets a profile place its own family list ahead of the built-in
 * one; this script writes that setting into the profile patch, checks it, and
 * takes it back out again.
 *
 * Zero dependencies. Node >= 18.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROLES = ['text', 'code', 'terminal'];
const ENTRY_ID = 'ui-theme';
const ENTRY_NAME = '@deepseek-ai/dsh-client-ui-theme';
const FIELD = { text: 'textFontFamily', code: 'codeFontFamily', terminal: 'terminalFontFamily' };
const MARKER = '# dsh-jp-fonts';

/** Built-in stacks the user list is prepended to (dsh-client-ui-theme, sidebar-terminal). */
const BUILTIN = {
  text: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
  code: '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"',
  terminal: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

/** Default lists per platform: Latin from the platform's native UI/mono face, CJK from a Japanese face. */
const DEFAULTS = {
  win32: {
    text: 'Segoe UI, Yu Gothic UI',
    code: 'Consolas, MS Gothic',
    terminal: 'Consolas, MS Gothic',
  },
  darwin: {
    text: '-apple-system, Hiragino Sans',
    code: 'SF Mono, Hiragino Sans',
    terminal: 'SF Mono, Hiragino Sans',
  },
  linux: {
    text: 'Noto Sans JP, Noto Sans CJK JP',
    code: 'JetBrains Mono, Noto Sans Mono CJK JP',
    terminal: 'JetBrains Mono, Noto Sans Mono CJK JP',
  },
};

const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math',
  'fangsong', '-apple-system', 'blinkmacsystemfont',
]);

/** Families whose Han shapes are Chinese, not Japanese. */
const CHINESE = new Map([
  ['microsoft yahei', 'Microsoft YaHei'], ['microsoft yahei ui', 'Microsoft YaHei UI'],
  ['simsun', 'SimSun'], ['nsimsun', 'NSimSun'], ['simhei', 'SimHei'], ['dengxian', 'DengXian'],
  ['pingfang sc', 'PingFang SC'], ['hiragino sans gb', 'Hiragino Sans GB'], ['heiti sc', 'Heiti SC'],
  ['noto sans sc', 'Noto Sans SC'], ['noto sans cjk sc', 'Noto Sans CJK SC'],
  ['source han sans sc', 'Source Han Sans SC'], ['source han sans cn', 'Source Han Sans CN'],
  ['wenquanyi micro hei', 'WenQuanYi Micro Hei'],
  ['microsoft jhenghei', 'Microsoft JhengHei'], ['pingfang tc', 'PingFang TC'],
  ['noto sans tc', 'Noto Sans TC'], ['noto sans cjk tc', 'Noto Sans CJK TC'],
]);

/** Families whose Han shapes are Japanese. */
const JAPANESE = new Map([
  ['yu gothic', 'Yu Gothic'], ['yu gothic ui', 'Yu Gothic UI'], ['yu mincho', 'Yu Mincho'],
  ['meiryo', 'Meiryo'], ['meiryo ui', 'Meiryo UI'],
  ['ms gothic', 'MS Gothic'], ['ms pgothic', 'MS PGothic'], ['ms ui gothic', 'MS UI Gothic'],
  ['biz udgothic', 'BIZ UDGothic'], ['biz udp gothic', 'BIZ UDPGothic'],
  ['ud digi kyokasho', 'UD Digi Kyokasho'], ['ud digi kyokasho n', 'UD Digi Kyokasho N'],
  ['hiragino sans', 'Hiragino Sans'], ['hiragino kaku gothic pro', 'Hiragino Kaku Gothic Pro'],
  ['hiragino kaku gothic pron', 'Hiragino Kaku Gothic ProN'],
  ['hiragino mincho pro', 'Hiragino Mincho Pro'], ['hiragino mincho pron', 'Hiragino Mincho ProN'],
  ['noto sans jp', 'Noto Sans JP'], ['noto serif jp', 'Noto Serif JP'],
  ['noto sans cjk jp', 'Noto Sans CJK JP'], ['noto sans mono cjk jp', 'Noto Sans Mono CJK JP'],
  ['source han sans jp', 'Source Han Sans JP'], ['source han code jp', 'Source Han Code JP'],
  ['ipagothic', 'IPAGothic'], ['ipaexgothic', 'IPAGothic'], ['takao gothic', 'TakaoGothic'],
]);

// ---------------------------------------------------------------- utilities

const c = {
  bold: (s) => `\u001b[1m${s}\u001b[22m`,
  dim: (s) => `\u001b[2m${s}\u001b[22m`,
  red: (s) => `\u001b[31m${s}\u001b[39m`,
  green: (s) => `\u001b[32m${s}\u001b[39m`,
  yellow: (s) => `\u001b[33m${s}\u001b[39m`,
  cyan: (s) => `\u001b[36m${s}\u001b[39m`,
};
const color = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(fn, text) {
  return color ? fn(text) : text;
}

function die(message) {
  console.error(`dsh-jp-fonts: ${message}`);
  process.exit(1);
}

/** Split a CSS font-family list into bare family names. */
function parseList(value) {
  return value
    .split(',')
    .map((name) => name.replace(/["'\\<>\u0000-\u001f\u007f]/gu, '').replace(/\s+/gu, ' ').trim())
    .filter((name) => name !== '');
}

/** Normalize like dsh does before embedding the list in CSS. */
function normalizeList(value) {
  return parseList(value)
    .map((name) => (GENERIC.has(name.toLowerCase()) ? name : `"${name}"`))
    .join(', ');
}

/** The family that would supply Han glyphs, given list order. */
function hanSource(list) {
  for (const name of parseList(list)) {
    const key = name.toLowerCase();
    if (JAPANESE.has(key)) return { name: JAPANESE.get(key), kind: 'japanese' };
    if (CHINESE.has(key)) return { name: CHINESE.get(key), kind: 'chinese' };
  }
  return undefined;
}

// ---------------------------------------------------------------- patch file

function patchPath(options) {
  const home = options.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return { home: resolve(home), file: join(resolve(home), 'profiles', options.profile, 'cordis.patch.yml') };
}

function readPatch(file) {
  if (!existsSync(file)) return { text: '', eol: '\n', lines: [] };
  const text = readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { text, eol, lines };
}

const TOP = /^-(?:\s|$)/;

/** Locate the `- id: <id>` block: [start, end) line indexes, and its `config:` range. */
function locate(lines, id) {
  const start = lines.findIndex(
    (line) => TOP.test(line) && new RegExp(`^-\\s+id:\\s*["']?${id}["']?\\s*$`).test(line),
  );
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !TOP.test(lines[end])) end += 1;

  const configRel = lines.slice(start, end).findIndex((line) => /^ {2}config:\s*$/.test(line));
  if (configRel < 0) return { start, end, config: undefined };

  const configLine = start + configRel;
  let configEnd = configLine + 1;
  while (configEnd < end && /^ {3,}\S/.test(lines[configEnd])) {
    configEnd += 1;
  }
  return { start, end, config: { line: configLine, end: configEnd } };
}

function quote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Read one `  <field>: <value>` out of the entry, if present. */
function readField(lines, entry, field) {
  if (!entry?.config) return undefined;
  for (let i = entry.config.line + 1; i < entry.config.end; i += 1) {
    const match = new RegExp(`^ {4}${field}:\\s*(.*?)\\s*$`).exec(lines[i]);
    if (match) return match[1].replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");
  }
  return undefined;
}

/** Value as a YAML scalar: quote only when the plain form would be ambiguous. */
function scalar(value) {
  return /^[A-Za-z0-9][A-Za-z0-9 ,._+\-/]*$/.test(value) ? value : quote(value);
}

// ---------------------------------------------------------------- commands

function describe(options) {
  const { home, file } = patchPath(options);
  const patch = readPatch(file);
  const entry = locate(patch.lines, ENTRY_ID);
  const wanted = ROLES.map((role) => [role, readField(patch.lines, entry, FIELD[role])]);
  return { home, file, patch, entry, wanted };
}

function cmdCheck(options) {
  const { home, file, patch, entry } = describe(options);
  const exists = existsSync(file);
  console.log(`${paint(c.bold, 'profile')}  ${options.profile}`);
  console.log(`${paint(c.bold, 'patch')}    ${file}${exists ? '' : paint(c.dim, ' (missing)')}`);
  if (!exists) {
    console.log(paint(c.yellow, '  no profile patch: the built-in stacks apply as shipped'));
  }

  const values = {};
  let configured = 0;
  for (const role of ROLES) {
    const value = readField(patch.lines, entry, FIELD[role]);
    values[role] = value;
    if (value) configured += 1;
  }
  if (configured === 0) {
    console.log(paint(c.yellow, `  ${ENTRY_ID} has no font-family setting`));
  }

  console.log('');
  let bad = 0;
  for (const role of ROLES) {
    const user = values[role];
    const effective = user ? `${normalizeList(user)}, ${BUILTIN[role]}` : BUILTIN[role];
    const source = hanSource(effective);
    const label = role.padEnd(8);
    console.log(paint(c.bold, `${label} ${user ?? paint(c.dim, '(built-in stack)')}`));
    console.log(`         ${paint(c.dim, shorten(effective))}`);
    if (!source) {
      console.log(`         ${paint(c.yellow, '-> no known CJK family: the browser default decides')}`);
      bad += 1;
    } else if (source.kind === 'chinese') {
      console.log(`         ${paint(c.red, `-> ${source.name} (Simplified-Chinese shapes)`)}`);
      bad += 1;
    } else {
      console.log(`         ${paint(c.green, `-> ${source.name} (Japanese shapes)`)}`);
    }
    console.log('');
  }

  if (bad === 0) {
    console.log(paint(c.green, 'OK: every role resolves Han glyphs to a Japanese family.'));
    return 0;
  }
  console.log(paint(c.yellow, 'The UI will render kanji with Chinese shapes. Run `apply` (see --help).'));
  return 1;
}

function shorten(list) {
  const max = 118;
  return list.length <= max ? list : `${list.slice(0, max - 1)}…`;
}

function cmdApply(options) {
  const { file } = patchPath(options);
  const patch = readPatch(file);
  const lines = [...patch.lines];
  const values = {};
  for (const role of ROLES) {
    const fallback = DEFAULTS[process.platform]?.[role] ?? DEFAULTS.linux[role];
    values[role] = options[role] ?? fallback;
    if (parseList(values[role]).length === 0) die(`--${role} needs at least one family name`);
  }

  const entry = locate(lines, ENTRY_ID);
  const changed = [];

  const setField = (line, field, value) => {
    const next = `    ${field}: ${scalar(value)}`;
    if (lines[line].trim() === next.trim()) return false;
    lines[line] = next;
    return true;
  };

  if (!entry) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push(
      `${MARKER} — Japanese-first font stacks (revert: node dsh-jp-fonts.mjs revert)`,
      `- id: ${ENTRY_ID}`,
      `  name: "${ENTRY_NAME}"`,
      '  config:',
      ...ROLES.map((role) => `    ${FIELD[role]}: ${scalar(values[role])}`),
    );
    changed.push(`inserted the ${ENTRY_ID} entry`);
  } else {
    let { config } = entry;
    if (!config) {
      const insertAt = entry.end;
      lines.splice(insertAt, 0, '  config:', ...ROLES.map((role) => `    ${FIELD[role]}: ${scalar(values[role])}`));
      changed.push('added a config block');
    } else {
      const missing = [];
      for (const role of ROLES) {
        const field = FIELD[role];
        let found = -1;
        for (let i = config.line + 1; i < config.end; i += 1) {
          if (new RegExp(`^ {4}${field}:`).test(lines[i])) found = i;
        }
        if (found >= 0) {
          if (setField(found, field, values[role])) changed.push(`${field} -> ${values[role]}`);
        } else {
          missing.push({ field, value: values[role] });
        }
      }
      if (missing.length) {
        const at = config.end;
        lines.splice(at, 0, ...missing.map(({ field, value }) => `    ${field}: ${scalar(value)}`));
        for (const { field, value } of missing) changed.push(`${field} -> ${value} (added)`);
      }
    }
  }

  if (!changed.length) {
    console.log(`${paint(c.green, 'unchanged')} ${file}`);
    return cmdCheck(options);
  }

  const next = `${lines.join(patch.eol)}${patch.eol}`;
  if (options.dryRun) {
    console.log(paint(c.yellow, '--- dry run, nothing written ---'));
    console.log(next);
    return 0;
  }

  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.bak-${stamp}`;
    copyFileSync(file, backup);
    console.log(`${paint(c.dim, 'backup')}    ${backup}`);
  }
  writeFileSync(file, next, 'utf8');
  console.log(`${paint(c.green, 'updated')}   ${file}`);
  for (const item of changed) console.log(`  ${item}`);
  console.log('');
  if (options.profile === 'desktop') {
    console.log(paint(c.yellow, 'Restart the dsh desktop app to load the profile patch.'));
    console.log(paint(c.dim, 'Or type the same lists into Settings > General > Text font / Code font / Terminal font, which applies live.'));
  }
  return cmdCheck(options);
}

function cmdRevert(options) {
  const { file } = patchPath(options);
  if (!existsSync(file)) {
    console.log(`${paint(c.dim, 'nothing to revert')} ${file}`);
    return 0;
  }
  const patch = readPatch(file);
  const lines = [...patch.lines];
  const entry = locate(lines, ENTRY_ID);
  if (!entry) {
    console.log(`${paint(c.dim, 'no ui-theme entry in')} ${file}`);
    return 0;
  }

  const owned = (() => {
    for (let i = entry.start - 1; i >= 0; i -= 1) {
      if (lines[i].trim() === '') continue;
      return lines[i].startsWith(MARKER);
    }
    return false;
  })();

  let touched = 0;
  if (entry.config) {
    for (const role of ROLES) {
      const field = FIELD[role];
      for (let i = entry.config.line + 1; i < entry.config.end; i += 1) {
        if (new RegExp(`^ {4}${field}:`).test(lines[i])) {
          lines.splice(i, 1);
          touched += 1;
          i -= 1;
          entry.config.end -= 1;
          entry.end -= 1;
        }
      }
    }
    // An empty config block is left over once every field is gone.
    if (entry.config.end === entry.config.line + 1) {
      lines.splice(entry.config.line, 1);
      entry.end -= 1;
      touched += 1;
    }
  }

  const from = entry.start > 0 && lines[entry.start - 1].startsWith(MARKER) ? entry.start - 1 : entry.start;
  const body = lines.slice(entry.start, entry.end);
  const hasOtherKeys = body.some((line, index) => index > 0 && /^ {2}\S/.test(line) && !/^ {2}(id|name):/.test(line));

  if (owned || !hasOtherKeys) {
    // Either the row is ours, or nothing but `id`/`name` is left and the row
    // would be a no-op override.
    lines.splice(from, entry.end - from);
    touched += 1;
  }

  if (!touched) {
    console.log(`${paint(c.dim, 'nothing to revert')} ${file}`);
    return 0;
  }

  const next = `${lines.join(patch.eol)}${patch.eol}`;
  if (options.dryRun) {
    console.log(paint(c.yellow, '--- dry run, nothing written ---'));
    console.log(next);
    return 0;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${file}.bak-${stamp}`;
  copyFileSync(file, backup);
  console.log(`${paint(c.dim, 'backup')}    ${backup}`);
  writeFileSync(file, next, 'utf8');
  console.log(`${paint(c.green, 'reverted')}  ${file}`);
  return 0;
}

// ---------------------------------------------------------------- entry point

const HELP = `dsh-jp-fonts — Japanese-first font stacks for the dsh web UI

Usage
  node dsh-jp-fonts.mjs [check|apply|revert] [options]

Commands
  check    (default) show the lists the profile resolves to, and which family
           supplies Han glyphs. Exit code 1 when that family is Chinese.
  apply    write the three font-family fields into the profile patch.
  revert   remove them again (keeps the entry if it was already there).

Options
  --profile <name>   dsh profile (default: desktop)
  --home <dir>       dsh home (default: $DSH_HOME, else ~/.dsh)
  --text <list>      comma separated families for interface and conversation text
  --code <list>      ... for code blocks, inline code and tool output
  --terminal <list>  ... for the sidebar terminal
  --dry-run          print the resulting patch, write nothing
  -h, --help         this text

Defaults (${process.platform})
${ROLES.map((role) => `  ${role.padEnd(9)}${JSON.stringify(DEFAULTS[process.platform]?.[role] ?? DEFAULTS.linux[role])}`).join('\n')}
`;

function parseArgs(argv) {
  const options = { profile: 'desktop', command: 'check' };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === '-h' || arg === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--profile' || arg === '--home' || arg === '--text' || arg === '--code' || arg === '--terminal') {
      const value = rest.shift();
      if (value === undefined) die(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) {
      die(`unknown option ${arg} (try --help)`);
    } else if (['check', 'apply', 'revert'].includes(arg)) {
      options.command = arg;
    } else {
      die(`unknown command ${arg} (try --help)`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
process.exitCode =
  options.command === 'apply' ? cmdApply(options)
  : options.command === 'revert' ? cmdRevert(options)
  : cmdCheck(options);

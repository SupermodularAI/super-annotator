#!/usr/bin/env node
/*
 * Standalone injector for the Supermodular click-to-annotate overlay.
 * No dependencies — just Node.js. Reads sibling annotator.js and inlines it
 * into any HTML file(s) between idempotent markers.
 *
 * Usage:
 *   node inject-annotate.js <file-or-directory> [options]
 *
 * Options:
 *   --key=<string>       window.SM_ARTEFACT_KEY  — shared localStorage key across a multi-file deck
 *   --name=<string>      window.SM_ARTEFACT_NAME — display name shown in exports
 *   --reviewer=<string>  window.SM_REVIEWER_NAME — pre-fill reviewer name
 *   --plugin             window.SM_ANNOTATE_PLUGIN = true — ship dormant, activate via ?=annotate
 *   --sync=<ws(s)://…>   window.SM_ANNOTATE_SYNC.url — live multiplayer through a relay (see relay/)
 *   --room=<string>      window.SM_ANNOTATE_SYNC.room — who shares comments (default: the file name)
 *   --recursive          scan directories recursively (default: one level deep)
 *
 * Re-running on an already-injected file refreshes the block in place (same
 * markers used by the Claude Code /annotate skill, so either tool can update
 * files the other one touched).
 */

const fs = require('fs');
const path = require('path');

const MARKER_START = '<!-- annotate:v1 START -->';
const MARKER_END = '<!-- annotate:v1 END -->';

function parseArgs(argv) {
  const opts = { target: null, key: null, name: null, reviewer: null, plugin: false, recursive: false };
  for (const arg of argv) {
    if (arg === '--plugin') opts.plugin = true;
    else if (arg === '--recursive') opts.recursive = true;
    else if (arg.startsWith('--key=')) opts.key = arg.slice(6);
    else if (arg.startsWith('--name=')) opts.name = arg.slice(7);
    else if (arg.startsWith('--reviewer=')) opts.reviewer = arg.slice(11);
    else if (arg.startsWith('--sync=')) opts.sync = arg.slice(7);
    else if (arg.startsWith('--room=')) opts.room = arg.slice(7);
    else if (!arg.startsWith('--')) opts.target = arg;
  }
  return opts;
}

function findHtmlFiles(target, recursive) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];

  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Local CLI tool: `dir` is a path the user explicitly passed, and
      // `entry.name` comes from reading that same directory. There is no
      // untrusted/network input crossing a trust boundary here.
      const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      if (entry.isDirectory()) {
        if (recursive) walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        results.push(full);
      }
    }
  };
  walk(target);
  return results;
}

function buildBlock(annotatorSrc, opts, filePath) {
  const overrides = [];
  if (opts.key) overrides.push(`window.SM_ARTEFACT_KEY = ${JSON.stringify(opts.key)};`);
  if (opts.name) overrides.push(`window.SM_ARTEFACT_NAME = ${JSON.stringify(opts.name)};`);
  if (opts.reviewer) overrides.push(`window.SM_REVIEWER_NAME = ${JSON.stringify(opts.reviewer)};`);
  if (opts.plugin) overrides.push(`window.SM_ANNOTATE_PLUGIN = true;`);
  if (opts.sync) {
    const room = opts.room || path.basename(filePath || 'page', '.html');
    overrides.push(`window.SM_ANNOTATE_SYNC = ${JSON.stringify({ url: opts.sync, room })};`);
  }

  const overrideBlock = overrides.length
    ? `<script>\n${overrides.map((l) => '  ' + l).join('\n')}\n</script>\n`
    : '';

  return `${MARKER_START}\n${overrideBlock}<script>\n${annotatorSrc}\n</script>\n${MARKER_END}`;
}

function injectInto(filePath, block) {
  const html = fs.readFileSync(filePath, 'utf8');
  const startIdx = html.indexOf(MARKER_START);
  const endIdx = html.indexOf(MARKER_END);

  let next;
  let status;
  if (startIdx !== -1 && endIdx !== -1) {
    next = html.slice(0, startIdx) + block + html.slice(endIdx + MARKER_END.length);
    status = 'refreshed';
  } else {
    const bodyIdx = html.lastIndexOf('</body>');
    if (bodyIdx === -1) return { status: 'skipped (no </body> tag found)' };
    next = html.slice(0, bodyIdx) + block + '\n' + html.slice(bodyIdx);
    status = 'injected';
  }

  fs.writeFileSync(filePath, next, 'utf8');
  return { status };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) {
    console.error('Usage: node inject-annotate.js <file-or-directory> [--key=] [--name=] [--reviewer=] [--plugin] [--sync=] [--room=] [--recursive]');
    process.exit(1);
  }

  const annotatorPath = path.join(__dirname, 'annotator.js');
  if (!fs.existsSync(annotatorPath)) {
    console.error(`annotator.js not found next to this script (expected at ${annotatorPath}).`);
    process.exit(1);
  }
  const annotatorSrc = fs.readFileSync(annotatorPath, 'utf8');

  const files = findHtmlFiles(opts.target, opts.recursive);
  if (!files.length) {
    console.log('No .html files found at', opts.target);
    return;
  }

  for (const file of files) {
    const { status } = injectInto(file, buildBlock(annotatorSrc, opts, file));
    console.log(`${status.padEnd(28)} ${file}`);
  }
}

main();

// ─────────────────────────────────────────────────────────────────────────────
// FCP COMMAND — Manage Federated Context Protocol sources.
//   phaibel fcp list
//   phaibel fcp add <id> --url <url> [--trust <tier>] [--auth bearer --token-ref <ref>]
//   phaibel fcp remove <id>
//   phaibel fcp enable|disable <id>
//   phaibel fcp manifest <id>    — fetch and print a source's manifest
//   phaibel fcp probe <keywords> — probe all enabled sources
//   phaibel fcp fetch <id> <ids...> — full fetch from a single source
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import {
    loadSourceRegistry, saveSourceRegistry,
    addSource, removeSource,
    getManifest, probeSource, fetchFromSource,
    probeAll,
    type SourceConfig, type Actor,
} from '../federation/index.js';
import { getUserName } from '../state/manager.js';

export const fcpCommand = new Command('fcp')
    .description('Manage Federated Context Protocol sources');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getActor(): Promise<Actor> {
    const name = await getUserName().catch(() => 'unknown');
    return { agent_id: `phaibel:${name}` };
}

/** Wrap an action so the process exits cleanly after it finishes. */
function exitAfter<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
    return async (...args: A) => {
        try {
            await fn(...args);
            process.exit(0);
        } catch (err) {
            console.error(chalk.red(`\n  ${err instanceof Error ? err.message : err}\n`));
            process.exit(1);
        }
    };
}

function findSource(registry: { sources: SourceConfig[] }, id: string): SourceConfig | undefined {
    return registry.sources.find(s => s.id === id);
}

// ── list ─────────────────────────────────────────────────────────────────────

fcpCommand
    .command('list')
    .description('Show all configured FCP sources')
    .action(exitAfter(async () => {
        const reg = await loadSourceRegistry();
        if (reg.sources.length === 0) {
            console.log(chalk.yellow('\n  No FCP sources configured.'));
            console.log(chalk.gray(`  Use ${chalk.bold('phaibel fcp add <id> --url <url>')} to add one.\n`));
            return;
        }
        console.log(chalk.cyan('\n  Configured FCP sources:\n'));
        for (const s of reg.sources) {
            const status = s.enabled ? chalk.green('enabled') : chalk.gray('disabled');
            console.log(`    ${chalk.bold(s.id)} ${chalk.gray(`[${s.trust}]`)} ${status}`);
            console.log(chalk.gray(`      url:   ${s.url}`));
            console.log(chalk.gray(`      auth:  ${s.auth.type}${s.auth.token_ref ? ` (token_ref=${s.auth.token_ref})` : ''}`));
            if (s.scopes.length > 0) console.log(chalk.gray(`      scopes: ${s.scopes.join(', ')}`));
            console.log('');
        }
    }));

// ── add ──────────────────────────────────────────────────────────────────────

fcpCommand
    .command('add <id>')
    .description('Add an FCP source')
    .requiredOption('--url <url>', 'Base URL of the FCP source (e.g. https://example.com/fcp)')
    .option('--trust <tier>', 'Trust tier: own | team | peer | public', 'peer')
    .option('--auth <type>', 'Auth type: bearer | signed | none', 'none')
    .option('--token-ref <ref>', 'Secrets provider name holding the bearer token')
    .option('--scopes <types...>', 'Entity types to probe (empty = all)')
    .action(exitAfter(async (id: string, opts: { url: string; trust: string; auth: string; tokenRef?: string; scopes?: string[] }) => {
        const trust = opts.trust as SourceConfig['trust'];
        if (!['own', 'team', 'peer', 'public'].includes(trust)) {
            console.log(chalk.red(`\n  Invalid trust tier "${opts.trust}". Use one of: own, team, peer, public.\n`));
            return;
        }
        const authType = opts.auth as SourceConfig['auth']['type'];
        if (!['bearer', 'signed', 'none'].includes(authType)) {
            console.log(chalk.red(`\n  Invalid auth type "${opts.auth}". Use one of: bearer, signed, none.\n`));
            return;
        }
        if (authType === 'bearer' && !opts.tokenRef) {
            console.log(chalk.yellow(`\n  Warning: bearer auth specified without --token-ref. Requests will be unauthenticated.\n`));
        }

        const source: SourceConfig = {
            id,
            url: opts.url.replace(/\/$/, ''),
            trust,
            auth: { type: authType, token_ref: opts.tokenRef },
            scopes: opts.scopes ?? [],
            enabled: true,
        };

        await addSource(source);
        console.log(chalk.green(`\n  FCP source "${id}" added.\n`));
    }));

// ── remove ───────────────────────────────────────────────────────────────────

fcpCommand
    .command('remove <id>')
    .description('Remove an FCP source')
    .action(exitAfter(async (id: string) => {
        const removed = await removeSource(id);
        if (!removed) {
            console.log(chalk.yellow(`\n  No FCP source found with id "${id}".\n`));
            return;
        }
        console.log(chalk.green(`\n  FCP source "${id}" removed.\n`));
    }));

// ── enable / disable ────────────────────────────────────────────────────────

for (const verb of ['enable', 'disable'] as const) {
    fcpCommand
        .command(`${verb} <id>`)
        .description(`${verb[0].toUpperCase() + verb.slice(1)} an FCP source`)
        .action(exitAfter(async (id: string) => {
            const reg = await loadSourceRegistry();
            const src = findSource(reg, id);
            if (!src) {
                console.log(chalk.yellow(`\n  No FCP source found with id "${id}".\n`));
                return;
            }
            src.enabled = verb === 'enable';
            await saveSourceRegistry(reg);
            console.log(chalk.green(`\n  FCP source "${id}" ${verb}d.\n`));
        }));
}

// ── manifest ─────────────────────────────────────────────────────────────────

fcpCommand
    .command('manifest <id>')
    .description('Fetch and show a source manifest')
    .action(exitAfter(async (id: string) => {
        const reg = await loadSourceRegistry();
        const src = findSource(reg, id);
        if (!src) {
            console.log(chalk.red(`\n  Unknown source "${id}". Run ${chalk.bold('phaibel fcp list')}.\n`));
            return;
        }
        try {
            const manifest = await getManifest(src);
            console.log('');
            console.log(chalk.cyan.bold(`  ${manifest.name} ${chalk.gray(`(${manifest.source})`)}`));
            console.log(chalk.gray(`  trust: ${manifest.trust}  ·  auth: ${manifest.auth_methods.join(', ')}  ·  fcp: v${manifest.fcp_version}`));
            console.log(chalk.gray(`  entity types: ${manifest.entity_types.join(', ')}`));
            if (manifest.contact) console.log(chalk.gray(`  contact: ${manifest.contact}`));
            console.log('');
        } catch (err) {
            console.log(chalk.red(`\n  Failed to fetch manifest: ${err instanceof Error ? err.message : err}\n`));
        }
    }));

// ── probe ────────────────────────────────────────────────────────────────────

fcpCommand
    .command('probe <keywords...>')
    .description('Probe all enabled sources for keywords')
    .option('--source <id>', 'Probe only this source')
    .option('--timeout <ms>', 'Timeout per source in ms', (v) => parseInt(v, 10), 1000)
    .action(exitAfter(async (keywords: string[], opts: { source?: string; timeout: number }) => {
        if (opts.source) {
            const reg = await loadSourceRegistry();
            const src = findSource(reg, opts.source);
            if (!src) {
                console.log(chalk.red(`\n  Unknown source "${opts.source}".\n`));
                return;
            }
            const actor = await getActor();
            try {
                const resp = await probeSource(src, actor, keywords, { timeoutMs: opts.timeout });
                console.log(chalk.cyan(`\n  ${src.id} — ${resp.matches.length} type(s) matched:\n`));
                for (const m of resp.matches) {
                    console.log(`    ${chalk.bold(m.type)}: ${m.count}`);
                    for (const s of m.samples) {
                        console.log(chalk.gray(`      ${s.id}  ${s.title}  (${s.score.toFixed(2)})`));
                    }
                }
                console.log('');
            } catch (err) {
                console.log(chalk.red(`\n  Probe failed: ${err instanceof Error ? err.message : err}\n`));
            }
            return;
        }

        // All sources
        const result = await probeAll(keywords, { timeoutMs: opts.timeout });
        if (result.sources.length === 0) {
            console.log(chalk.yellow('\n  No enabled FCP sources configured.\n'));
            return;
        }
        console.log(chalk.cyan(`\n  Probed ${result.sources.length} source(s) in ${result.totalMs}ms:\n`));
        for (const r of result.sources) {
            if (r.error) {
                console.log(`    ${chalk.bold(r.source)} ${chalk.red('error')}: ${r.error} ${chalk.gray(`(${r.latencyMs}ms)`)}`);
                continue;
            }
            const summary = r.matches.length === 0
                ? chalk.gray('no matches')
                : r.matches.map(m => `${m.type}:${m.count}`).join(', ');
            console.log(`    ${chalk.bold(r.source)} ${chalk.gray(`[${r.trust}]`)} — ${summary} ${chalk.gray(`(${r.latencyMs}ms)`)}`);
            for (const m of r.matches) {
                for (const s of m.samples) {
                    console.log(chalk.gray(`        ${m.type}:${s.id}  "${s.title}"  (${s.score.toFixed(2)})`));
                }
            }
        }
        console.log('');
    }));

// ── fetch ────────────────────────────────────────────────────────────────────

fcpCommand
    .command('fetch <sourceId> <ids...>')
    .description('Fetch full content for IDs from a source')
    .option('--detail <level>', 'summary | full', 'full')
    .option('--purpose <text>', 'Purpose string (logged by the source)')
    .action(exitAfter(async (sourceId: string, ids: string[], opts: { detail: string; purpose?: string }) => {
        const detail = opts.detail as 'summary' | 'full';
        if (!['summary', 'full'].includes(detail)) {
            console.log(chalk.red(`\n  Invalid --detail "${opts.detail}". Use "summary" or "full".\n`));
            return;
        }
        const reg = await loadSourceRegistry();
        const src = findSource(reg, sourceId);
        if (!src) {
            console.log(chalk.red(`\n  Unknown source "${sourceId}".\n`));
            return;
        }
        const actor = await getActor();
        try {
            const resp = await fetchFromSource(src, actor, ids, { detail, purpose: opts.purpose });
            console.log(chalk.cyan(`\n  ${src.id} — ${resp.nodes.length} node(s) returned${resp.denied_ids.length ? `, ${resp.denied_ids.length} denied` : ''}:\n`));
            for (const n of resp.nodes) {
                console.log(`    ${chalk.bold(n.title)} ${chalk.gray(`(${n.type}:${n.id})`)}`);
                if (n.summary) console.log(chalk.gray(`      ${n.summary}`));
                if (n.body) {
                    const preview = n.body.slice(0, 240);
                    console.log(chalk.gray(`      ${preview}${n.body.length > 240 ? '…' : ''}`));
                }
                console.log('');
            }
            if (resp.denied_ids.length > 0) {
                console.log(chalk.yellow(`  Denied IDs: ${resp.denied_ids.join(', ')}\n`));
            }
        } catch (err) {
            console.log(chalk.red(`\n  Fetch failed: ${err instanceof Error ? err.message : err}\n`));
        }
    }));

export default fcpCommand;

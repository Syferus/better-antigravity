/**
 * Better Antigravity — VS Code command handlers.
 *
 * Each exported function is a command handler registered in extension.ts.
 *
 * @module commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsp from 'fs/promises';
import { AntigravitySDK } from 'antigravity-sdk';
import { getAppRoot, getTargetFiles, isPatched, revertAll } from './auto-run';

/**
 * Show extension status in the output channel.
 */
export async function status(sdk: AntigravitySDK | null, output: vscode.OutputChannel): Promise<void> {
    const agv = sdk?.agVersion;
    const agLine = agv
        ? `v${agv.version} (${agv.compatible ? 'compatible' : `INCOMPATIBLE — SDK supports ${agv.supportedRange}`})`
        : 'not detected';

    const lines = [
        '=== Better Antigravity ===',
        '',
        `SDK:     ${sdk?.isInitialized ? `v${sdk.version}` : 'not initialized'}`,
        `AG:      ${agLine}`,
        `LS:      ${sdk?.ls?.isReady ? `port ${sdk.ls.port}` : 'not ready'}`,
        `UI:      ${sdk?.integration.isInstalled() ? 'installed' : 'not installed'}`,
        `Titles:  ${sdk?.integration.titles.count ?? 0} custom`,
    ];

    const root = getAppRoot();
    if (root) {
        const files = getTargetFiles(root);
        for (const f of files) {
            const patched = await isPatched(f.path);
            lines.push(`AutoRun: ${f.label} = ${patched ? 'fixed' : 'not fixed'}`);
        }
    } else {
        lines.push('AutoRun: app root not found');
    }

    output.appendLine(lines.join('\n'));
    output.show(true);
}

/**
 * Revert the auto-run fix and prompt for reload.
 *
 * Also clears V8 Code Cache to prevent stale cached patched code
 * from being loaded by Electron (which causes grey screen).
 */
export async function revertAutoRun(): Promise<void> {
    const results = revertAll();
    const reverted = results.filter(r => r.status === 'reverted').length;

    if (reverted > 0) {
        // Clear V8 Code Cache — stale cache after revert causes grey screen
        const appData = process.env.APPDATA || '';
        const cacheDirs = [
            path.join(appData, 'Antigravity', 'CachedData'),
            path.join(appData, 'Antigravity', 'GPUCache'),
            path.join(appData, 'Antigravity', 'Code Cache'),
        ];
        for (const d of cacheDirs) {
            try { await fsp.rm(d, { recursive: true, force: true }); } catch { /* may not exist */ }
        }

        const action = await vscode.window.showInformationMessage(
            `Auto-run fix reverted (${reverted} file(s)). Caches cleared. Reload to apply.`,
            'Reload Now',
        );
        if (action === 'Reload Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } else {
        vscode.window.showInformationMessage('No backups found. Nothing to revert.');
    }
}

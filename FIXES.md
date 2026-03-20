# Fixes — Technical Details

Detailed root cause analysis and patch descriptions for each fix in Better Antigravity.

---

## Auto-Run Fix

**Status:** Working
**Affected versions:** 1.107.0+
**Files patched:** `workbench.desktop.main.js`, `jetskiAgent/main.js`

### The Problem

You set **Settings -> Agent -> Terminal Execution -> "Always Proceed"**, but Antigravity **still asks you to click "Run"** on every single terminal command. Every. Single. Time.

The setting saves correctly, Strict Mode is off -- it just doesn't work.

### Root Cause

Found in the source code: the `run_command` step renderer component has an `onChange` handler that auto-confirms commands when you switch the dropdown to "Always run" **on a specific step**. But there's **no `useEffect` hook** that checks the saved policy at mount time and auto-confirms **new steps**.

In other words: the UI reads your setting, displays the correct dropdown value, but never actually acts on it automatically.

```javascript
// What exists (only fires on dropdown CHANGE):
v = Zt(B => {
    r?.setTerminalAutoExecutionPolicy?.(B),
    B === uF.EAGER && b(!0) // <- only when you manually switch
}, [r, b])

// What's MISSING (should fire on component mount):
useEffect(() => {
    if (policy === EAGER && !secureMode) confirm(true) // <- auto-confirm new steps
}, [])
```

### AG Version History

| AG Version | onChange Pattern | jetskiAgent Path |
|-----------|----------------|------------------|
| < v1.107 | `(arg)=>{setFn(arg), arg===ENUM.EAGER&&confirm(!0)}` | `out/vs/code/electron-browser/workbench/jetskiAgent.js` |
| >= v1.107 | `arg=>{ref?.setTerminalAutoExecutionPolicy?.(arg), arg===ENUM.EAGER&&confirm(!0)}` | `out/jetskiAgent/main.js` |

**Key changes in v1.107:**
- Minifier no longer wraps single arrow function arguments in parens: `(arg)=>` became `arg=>`
- Direct function call `setFn(arg)` became optional chaining method `ref?.setTerminalAutoExecutionPolicy?.(arg)`
- jetskiAgent bundle moved from `out/vs/code/electron-browser/workbench/` to `out/jetskiAgent/`

### How the Patch Works

The patcher uses **structural regex matching** to find the `onChange` handler in the minified source. It matches the code by shape, not by variable names -- so it works even when Antigravity re-minifies on update.

**Step 1: Find the onChange handler**

Pattern (v1.107+): `<var>=<useCallback>(<arg>=>{<ref>?.setTerminalAutoExecutionPolicy?.(<arg>),<arg>===<ENUM>.EAGER&&<confirm>(!0)},[`

This matches the handler structurally:
- An assignment to a variable
- A `useCallback` call
- Arrow function with one argument (no parens)
- Optional chaining on `setTerminalAutoExecutionPolicy`
- Backreference to the same arg name (`\3`)
- Check EAGER and confirm

**Step 2: Extract variable names from context**

From the surrounding 3000 characters, extract:
- `policyVar`: `<var>=<ref>?.terminalAutoExecutionPolicy??<ENUM>.OFF`
- `secureVar`: `<var>=<ref>?.secureModeEnabled??!1`
- `useEffectFn`: found via 3-phase strategy (see below)

**Step 3: Find useEffect alias (3-phase strategy)**

| Phase | Method | Reliability |
|-------|--------|-------------|
| 1. Declaration | `useEffect:()=>fn` in Preact export table | Most reliable — stable across versions |
| 2. Cleanup-return | `fn(()=>{...return ()=>...})` — only useEffect returns cleanup | High — structural, not name-based |
| 3. Frequency | Most common `fn(()=>{` in scope | Fallback — may pick wrong hook |

**Step 4: Generate and inject the patch**

```javascript
/*BA:autorun*/<useEffect>(()=>{<policyVar>===<ENUM>.EAGER&&!<secureVar>&&<confirm>(!0)},[]);
```

The trailing `;` is required — without it, `fn(...)return` in minified code is a SyntaxError.

The patch is injected after the `let` declaration semicolon that follows the `onChange` handler's `])`.

### Example Output (v1.107.0)

```
 Antigravity "Always Proceed" Auto-Run Fix

 C:\Users\user\AppData\Local\Programs\Antigravity
 Version: 1.107.0 (IDE 1.19.6)

  [workbench] Found onChange at offset 12362782
     enum=uF, confirm=b
     policyVar=u
     secureVar=d
     useEffect=fn (phase 1: declaration)
  [workbench] Patched (+44 bytes)
  [jetskiAgent] Found onChange at offset 8388797
     enum=Jd, confirm=F
     policyVar=d
     secureVar=f
     useEffect=At (phase 1: declaration)
  [jetskiAgent] Patched (+43 bytes)

Done! Restart Antigravity.
```

### Safety

- Original files are saved as `.ba-backup` before patching
- The patch marker `/*BA:autorun*/` prevents double-patching
- Only **adds** code, never removes existing logic
- `--revert` restores the original file from backup
- Async I/O in the extension prevents blocking the Extension Host

### Why two files?

The `run_command` step renderer exists in **two** bundles:

| Bundle | Path (v1.107+) | Size | Purpose |
|--------|---------------|------|---------|
| workbench | `out/vs/workbench/workbench.desktop.main.js` | ~15MB | Main IDE window |
| jetskiAgent | `out/jetskiAgent/main.js` | ~10MB | Cascade chat panel (Agent Manager) |

Both contain the same bug with slightly different minified variable names. The structural matcher handles both transparently.

The old `jetskiAgent.js` path (`out/vs/code/electron-browser/workbench/jetskiAgent.js`) is kept as a legacy fallback for AG versions below v1.107.

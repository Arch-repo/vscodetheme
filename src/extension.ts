import { join } from 'path'
import { TextEncoder } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import {
  commands as Commands,
  ConfigurationTarget,
  Uri,
  workspace,
  ExtensionContext,
  window,
} from 'vscode'
import { ChangelogWebview } from './webviews/Changelog'
import { updateCSS, updateTheme } from './utils'
import { BooTTYPanelViewProvider } from './panel-view-provider'
import { TerminalManager } from './terminal-manager'
import type { TerminalLocation } from './types/terminal'

let manager: TerminalManager | undefined
let panelProvider: BooTTYPanelViewProvider | undefined

/** Check for deprecated ghostty.* settings and warn user */
function checkDeprecatedSettings(): void {
  const deprecatedSettings = [
    'ghostty.fontFamily',
    'ghostty.fontSize',
    'ghostty.defaultTerminalLocation',
    'ghostty.bell',
    'ghostty.notifications',
  ]

  const ghosttyConfig = workspace.getConfiguration('ghostty')
  const foundSettings: string[] = []

  for (const setting of deprecatedSettings) {
    const key = setting.replace('ghostty.', '')
    const value = ghosttyConfig.inspect(key)
    if (
      value?.globalValue !== undefined ||
      value?.workspaceValue !== undefined ||
      value?.workspaceFolderValue !== undefined
    ) {
      foundSettings.push(setting)
    }
  }

  if (foundSettings.length > 0) {
    window
      .showWarningMessage(
        `BooTTY: Found deprecated "ghostty.*" settings. Please migrate to "bootty.*" settings. Found: ${foundSettings.join(', ')}`,
        'Open Settings'
      )
      .then((selection) => {
        if (selection === 'Open Settings') {
          Commands.executeCommand(
            'workbench.action.openSettings',
            'bootty'
          )
        }
      })
  }
}

/** Resolve cwd: ensure it's a directory, fallback to workspace or home */
function resolveCwd(uri?: Uri): string | undefined {
  if (!uri?.fsPath) {
    return workspace.workspaceFolders?.[0]?.uri.fsPath
  }

  try {
    const stat = fs.statSync(uri.fsPath)
    if (stat.isDirectory()) {
      return uri.fsPath
    }
    return path.dirname(uri.fsPath)
  } catch {
    return workspace.workspaceFolders?.[0]?.uri.fsPath
  }
}

/** Get default terminal location from settings */
function getDefaultLocation(): TerminalLocation {
  const config = workspace.getConfiguration('bootty')
  return config.get<TerminalLocation>('defaultTerminalLocation', 'panel')
}

/**
 * This method is called when the extension is activated.
 * It initializes the core functionality of the extension.
 */
export async function activate(context: ExtensionContext) {
  const flagPath = Uri.file(join(__dirname, '../temp', 'flag.txt'))
  let flag
  try {
    try {
      if (await workspace.fs.stat(flagPath)) {
        flag = true
      }
    } catch (error) {
      console.log(error)
    }
    if (!flag) {
      await workspace.fs.writeFile(flagPath, new TextEncoder().encode('true'))
      const configArr = [
        { defaultVal: false, type: 'bold' },
        { defaultVal: true, type: 'italic' },
        { defaultVal: false, type: 'vivid' },
      ]
      const configuration = workspace.getConfiguration('oneDarkPro')
      let isDefaultConfig = configArr.every((item) => {
        return configuration.get<boolean>(item.type) === item.defaultVal
      })
      const colorConfig = configuration.get<object>(`color`)
      let colorFlagStr = ''
      for (const key in colorConfig) {
        colorFlagStr += colorConfig[key]
      }
      if (colorFlagStr != '') {
        isDefaultConfig = false
      }
      if (!isDefaultConfig) {
        updateTheme()
      }
      if (!configuration.get<boolean>('markdownStyle')) {
        updateCSS()
      }
    }
  } catch (err) {
    console.log(err)
    // do nothing
  }

  // Observe changes in the config
  workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('oneDarkPro')) {
      updateTheme()
      updateCSS()
    }
  })
  Commands.registerCommand('oneDarkPro.showChangelog', () => {
    new ChangelogWebview().show()
  })

  const settingArr = ['Vivid', 'Italic', 'Bold']
  settingArr.forEach((settingItem) => {
    Commands.registerCommand(`oneDarkPro.set${settingItem}`, () => {
      workspace
        .getConfiguration()
        .update(
          `oneDarkPro.${settingItem.toLowerCase()}`,
          true,
          ConfigurationTarget.Global
        )
    })
    Commands.registerCommand(`oneDarkPro.cancel${settingItem}`, () => {
      workspace
        .getConfiguration()
        .update(
          `oneDarkPro.${settingItem.toLowerCase()}`,
          false,
          ConfigurationTarget.Global
        )
    })
  })

  // --- BooTTY Terminal Logic ---
  checkDeprecatedSettings()

  panelProvider = new BooTTYPanelViewProvider(context.extensionUri)
  manager = new TerminalManager(context, panelProvider)
  context.subscriptions.push(manager)

  panelProvider.setMessageHandler((message) => {
    manager!.handlePanelMessage(message)
  })

  context.subscriptions.push(
    window.registerWebviewViewProvider(
      BooTTYPanelViewProvider.viewType,
      panelProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  )

  async function createTerminalWithLocation(
    location: TerminalLocation,
    cwd?: string
  ) {
    if (location === 'panel') {
      await panelProvider!.show()
    }
    manager!.createTerminal({ cwd, location })
    if (location === 'panel') {
      panelProvider!.focusTerminal()
    }
  }

  // Helper to launch native Ghostty
  function launchNativeGhostty(uri?: Uri): void {
    const cwd = resolveCwd(uri) || process.env.HOME || '/'
    try {
      const child = spawn('ghostty', [], {
        cwd,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env }
      })
      child.unref()
    } catch (err: any) {
      window.showErrorMessage(`Failed to launch Ghostty: ${err.message}`)
    }
  }

  context.subscriptions.push(
    Commands.registerCommand('bootty.newTerminal', (uri?: Uri) => {
      launchNativeGhostty(uri)
    }),

    Commands.registerCommand('bootty.openNative', (uri?: Uri) => {
      launchNativeGhostty(uri)
    }),

    Commands.registerCommand('bootty.newTerminalInEditor', () =>
      manager!.createTerminal({
        cwd: resolveCwd(),
        location: 'editor',
      })
    ),

    Commands.registerCommand('bootty.newTerminalInPanel', async () => {
      await createTerminalWithLocation('panel', resolveCwd())
    }),

    Commands.registerCommand('bootty.togglePanel', async () => {
      if (panelProvider!.isVisible) {
        await Commands.executeCommand('workbench.action.closePanel')
      } else {
        await panelProvider!.show()
        if (!manager!.hasPanelTerminals()) {
          manager!.createTerminal({
            cwd: resolveCwd(),
            location: 'panel',
          })
        }
        panelProvider!.focusTerminal()
      }
    }),

    Commands.registerCommand(
      'bootty.newTerminalHere',
      (uri?: Uri) => {
        launchNativeGhostty(uri)
      }
    ),

    Commands.registerCommand('bootty.nextTab', () => {
      const ids = manager?.getTerminalIds() ?? []
      const activeId = manager?.getActiveTerminalId()
      if (ids.length === 0) return
      if (!activeId) {
        panelProvider?.activateTerminal(ids[0])
        return
      }
      const currentIndex = ids.indexOf(activeId)
      const nextIndex = (currentIndex + 1) % ids.length
      panelProvider?.activateTerminal(ids[nextIndex])
    }),

    Commands.registerCommand('bootty.previousTab', () => {
      const ids = manager?.getTerminalIds() ?? []
      const activeId = manager?.getActiveTerminalId()
      if (ids.length === 0) return
      if (!activeId) {
        panelProvider?.activateTerminal(ids[ids.length - 1])
        return
      }
      const currentIndex = ids.indexOf(activeId)
      const prevIndex = (currentIndex - 1 + ids.length) % ids.length
      panelProvider?.activateTerminal(ids[prevIndex])
    }),

    Commands.registerCommand('bootty.search', () => {
      if (manager?.showSearchInActiveEditor()) {
        return
      }
      panelProvider?.showSearch()
    }),

    Commands.registerCommand('bootty.splitTerminal', () => {
      const activeId = manager?.getActiveTerminalId()
      if (activeId) {
        manager?.splitTerminal(activeId)
      }
    })
  )
}

export function deactivate() {}

import app from "ags/gtk4/app";
import scss from "./superbar.scss";
import { Astal, Gdk, Gtk } from "ags/gtk4";
import { For, createEffect, createState, type Accessor } from "ags";
import { createSubprocess, execAsync } from "ags/process";
import { createPoll } from "ags/time";
import GLib from "gi://GLib?version=2.0";
import { createThemedWindowClass, getThemeVariablesCss, handleThemeRequest } from "../lib/theme";

type HyprWorkspace = {
  id: number;
  name: string;
  monitor: string;
  monitorID?: number;
  lastwindow?: string;
};

type HyprMonitor = {
  id: number;
  name: string;
  activeWorkspace?: {
    id: number;
    name: string;
  };
};

type HyprClient = {
  address: string;
  class?: string;
  initialClass?: string;
  title?: string;
  monitor?: number;
  mapped?: boolean;
  workspace?: {
    id: number;
    name: string;
  };
};

type HyprWorkspaceRule = {
  monitor: string;
  workspaceString: string;
};

type HyprBind = {
  dispatcher?: string;
  arg?: string;
  key?: string;
  description?: string;
};

type ClientIconRule = {
  defaultName?: string;
  extra?: Array<{
    title: string;
    name: string;
  }>;
};

type ClientsConfig = {
  defaultName?: string;
  [className: string]: string | ClientIconRule | undefined;
};

type WorkspaceClient = {
  icon: string;
  active: boolean;
};

type WorkspaceDisplay = {
  id: number;
  label: string;
  active: boolean;
  empty: boolean;
  clients: WorkspaceClient[];
};

type HyprState = {
  monitors: HyprMonitor[];
  workspaces: HyprWorkspace[];
  workspaceRules: HyprWorkspaceRule[];
  binds: HyprBind[];
  clients: HyprClient[];
  clientsConfig: ClientsConfig;
};

type RunningProgram = {
  key: string;
  className: string;
  address: string;
  iconName: string;
  tooltip: string;
};

type TrayItemLike = {
  itemId?: string;
  id?: string;
  title?: string;
  tooltipMarkup?: string;
  tooltipText?: string;
  iconName?: string;
  gicon?: any;
  isMenu?: boolean;
  activate?: (x: number, y: number) => void;
  secondaryActivate?: (x: number, y: number) => void;
  connect?: (signal: string, callback: (...args: unknown[]) => void) => number;
  disconnect?: (id: number) => void;
};

type TrayLike = {
  items?: unknown[];
  get_items?: () => unknown[];
  connect?: (signal: string, callback: (...args: unknown[]) => void) => number;
  disconnect?: (id: number) => void;
};

type HyprEvent = {
  tick: number;
  line: string;
};

const MAIN_MONITOR = "DP-1";
const BAR_WINDOW_NAME_PREFIX = "superbar-";
const BAR_NAMESPACE = "ags-superbar";
const CLIENTS_CONFIG_PATH = `${GLib.get_home_dir()}/.config/eww/includes/widgets/workspace/clients-config.json`;
const HYPR_FALLBACK_POLL_MS = 4000;
const HYPR_STATIC_POLL_MS = 60000;
const TRAY_FALLBACK_POLL_MS = 3000;
const HYPR_CLIENT_EVENT_PREFIXES = [
  "openwindow>>",
  "openwindowv2>>",
  "closewindow>>",
  "closewindowv2>>",
  "movewindow>>",
  "movewindowv2>>",
  "windowtitle>>",
  "windowtitlev2>>",
  "activewindow>>",
  "activewindowv2>>",
];
const DEFAULT_CLIENTS_CONFIG: ClientsConfig = {
  defaultName: "*",
};

const EMPTY_HYPR_STATE: HyprState = {
  monitors: [],
  workspaces: [],
  workspaceRules: [],
  binds: [],
  clients: [],
  clientsConfig: DEFAULT_CLIENTS_CONFIG,
};

function safeParseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeParseObject<T extends object>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function hyprSocketCommand(): string[] {
  const script = [
    "set -eu",
    "command -v socat >/dev/null 2>&1 || exec tail -f /dev/null",
    "runtime=\"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}\"",
    "base=\"$runtime/hypr\"",
    "sig=\"${HYPRLAND_INSTANCE_SIGNATURE:-}\"",
    "if [ -n \"$sig\" ] && [ -S \"$base/$sig/.socket2.sock\" ]; then",
    "  exec socat -u \"UNIX-CONNECT:$base/$sig/.socket2.sock\" -",
    "fi",
    "sock=\"$(ls -1dt \"$base\"/*/.socket2.sock 2>/dev/null | head -n1 || true)\"",
    "if [ -n \"$sock\" ] && [ -S \"$sock\" ]; then",
    "  exec socat -u \"UNIX-CONNECT:$sock\" -",
    "fi",
    "exec tail -f /dev/null",
  ].join("\n");

  return ["sh", "-c", script];
}

function shouldFetchClientsForEvent(line: string): boolean {
  if (!line) {
    return true;
  }

  return HYPR_CLIENT_EVENT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

async function fetchDynamicHyprState(previous: HyprState, includeClients = true) {
  const [monitorsRaw, workspacesRaw, clientsRaw] = await Promise.all([
    execAsync(["hyprctl", "-j", "monitors"]).catch(() => JSON.stringify(previous.monitors)),
    execAsync(["hyprctl", "-j", "workspaces"]).catch(() => JSON.stringify(previous.workspaces)),
    includeClients
      ? execAsync(["hyprctl", "-j", "clients"]).catch(() => JSON.stringify(previous.clients))
      : Promise.resolve(JSON.stringify(previous.clients)),
  ]);

  return {
    monitors: safeParseArray<HyprMonitor>(monitorsRaw),
    workspaces: safeParseArray<HyprWorkspace>(workspacesRaw),
    clients: safeParseArray<HyprClient>(clientsRaw),
  };
}

async function fetchStaticHyprState(previous: HyprState) {
  const [workspaceRulesRaw, bindsRaw, clientsConfigRaw] = await Promise.all([
    execAsync(["hyprctl", "-j", "workspacerules"]).catch(() => JSON.stringify(previous.workspaceRules)),
    execAsync(["hyprctl", "-j", "binds"]).catch(() => JSON.stringify(previous.binds)),
    execAsync(["cat", CLIENTS_CONFIG_PATH]).catch(() => JSON.stringify(previous.clientsConfig)),
  ]);

  return {
    workspaceRules: safeParseArray<HyprWorkspaceRule>(workspaceRulesRaw),
    binds: safeParseArray<HyprBind>(bindsRaw),
    clientsConfig: safeParseObject<ClientsConfig>(clientsConfigRaw, previous.clientsConfig),
  };
}

function workspaceHotkeyMap(binds: HyprBind[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const bind of binds) {
    if (bind.dispatcher !== "workspace" || !bind.arg || !bind.key) {
      continue;
    }

    if (bind.description && !bind.description.includes("select workspace:")) {
      continue;
    }

    const workspaceId = Number(bind.arg);
    if (Number.isFinite(workspaceId) && workspaceId > 0) {
      map.set(workspaceId, bind.key);
    }
  }

  return map;
}

function titleMatchesPattern(title: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(title);
  } catch {
    return title.includes(pattern);
  }
}

function iconForClient(client: HyprClient, config: ClientsConfig): string {
  const fallback = config.defaultName || DEFAULT_CLIENTS_CONFIG.defaultName || "*";
  const className = (client.class || client.initialClass || "").trim();
  if (!className) {
    return fallback;
  }

  const rule = config[className] ?? config[className.toLowerCase()];
  if (typeof rule === "string") {
    return rule;
  }

  if (rule && typeof rule === "object") {
    const extras = Array.isArray(rule.extra) ? rule.extra : [];
    const title = client.title || "";
    for (const extra of extras) {
      if (!extra?.title || !extra?.name) {
        continue;
      }
      if (titleMatchesPattern(title, extra.title)) {
        return extra.name;
      }
    }

    return rule.defaultName || fallback;
  }

  return fallback;
}

function workspaceClientsMap(state: HyprState): Map<number, WorkspaceClient[]> {
  const lastWindowByWorkspace = new Map<number, string>();
  for (const workspace of state.workspaces) {
    if (workspace.id > 0 && workspace.lastwindow) {
      lastWindowByWorkspace.set(workspace.id, workspace.lastwindow);
    }
  }

  const map = new Map<number, WorkspaceClient[]>();
  for (const client of state.clients) {
    if (client.mapped === false) {
      continue;
    }

    const workspaceId = client.workspace?.id;
    if (!workspaceId || workspaceId <= 0) {
      continue;
    }

    const item: WorkspaceClient = {
      icon: iconForClient(client, state.clientsConfig),
      active: lastWindowByWorkspace.get(workspaceId) === client.address,
    };

    const clients = map.get(workspaceId) || [];
    clients.push(item);
    map.set(workspaceId, clients);
  }

  return map;
}

function workspaceDisplayForMonitor(state: HyprState, monitorName: string): WorkspaceDisplay[] {
  const monitor = state.monitors.find((candidate) => candidate.name === monitorName);
  if (!monitor) {
    return [];
  }

  const existingWorkspaces = state.workspaces
    .filter((workspace) => workspace.id > 0 && workspace.monitor === monitorName)
    .sort((a, b) => a.id - b.id);

  const workspaceIds: number[] = [];
  for (const rule of state.workspaceRules) {
    if (rule.monitor !== monitorName) {
      continue;
    }

    const workspaceId = Number(rule.workspaceString);
    if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
      continue;
    }

    if (!workspaceIds.includes(workspaceId)) {
      workspaceIds.push(workspaceId);
    }
  }

  for (const workspace of existingWorkspaces) {
    if (!workspaceIds.includes(workspace.id)) {
      workspaceIds.push(workspace.id);
    }
  }

  const keys = workspaceHotkeyMap(state.binds);
  const workspaceClients = workspaceClientsMap(state);
  const activeWorkspaceId = monitor.activeWorkspace?.id ?? null;

  return workspaceIds.map((workspaceId) => {
    const workspaceExists = existingWorkspaces.some((workspace) => workspace.id === workspaceId);
    const clients = (workspaceClients.get(workspaceId) || []).map((client) => ({
      ...client,
      active: client.active && activeWorkspaceId === workspaceId,
    }));

    return {
      id: workspaceId,
      label: keys.get(workspaceId) || String(workspaceId),
      active: activeWorkspaceId === workspaceId,
      empty: !workspaceExists,
      clients,
    };
  });
}

function resolveIconName(className: string): string {
  const display = Gdk.Display.get_default();
  const theme = display ? Gtk.IconTheme.get_for_display(display) : null;
  const normalized = className.toLowerCase().replace(/\s+/g, "-");

  const candidates = [className, className.toLowerCase(), normalized, `${normalized}-symbolic`];
  for (const candidate of candidates) {
    if (theme?.has_icon(candidate)) {
      return candidate;
    }
  }

  return "application-x-executable-symbolic";
}

function runningProgramsForMonitor(state: HyprState, monitorName: string): RunningProgram[] {
  const monitorId = state.monitors.find((monitor) => monitor.name === monitorName)?.id;
  if (monitorId === undefined) {
    return [];
  }

  const byClass = new Map<string, RunningProgram>();
  for (const client of state.clients) {
    if (client.mapped === false || client.monitor !== monitorId) {
      continue;
    }

    const className = (client.class || client.initialClass || "").trim();
    if (!className) {
      continue;
    }

    const key = className.toLowerCase();
    if (byClass.has(key)) {
      continue;
    }

    byClass.set(key, {
      key,
      className,
      address: client.address,
      iconName: resolveIconName(className),
      tooltip: client.title ? `${className}: ${client.title}` : className,
    });
  }

  return [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className));
}

function switchWorkspace(workspaceId: number) {
  void execAsync(["hyprctl", "dispatch", "workspace", `${workspaceId}`]).catch(() => {});
}

function focusClient(address: string) {
  void execAsync(["hyprctl", "dispatch", "focuswindow", `address:${address}`]).catch(() => {});
}

function tryConnectSignal(
  object: { connect?: (signal: string, callback: (...args: unknown[]) => void) => number } | null | undefined,
  signal: string,
  callback: (...args: unknown[]) => void,
): number | null {
  if (!object?.connect) {
    return null;
  }

  try {
    const id = object.connect(signal, callback);
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

function tryDisconnectSignal(
  object: { disconnect?: (id: number) => void } | null | undefined,
  id: number | null,
) {
  if (!object?.disconnect || id === null) {
    return;
  }

  try {
    object.disconnect(id);
  } catch {
    // no-op
  }
}

function trayItemsFromSource(tray: TrayLike | null): TrayItemLike[] {
  if (!tray) {
    return [];
  }

  if (Array.isArray(tray.items)) {
    return tray.items as TrayItemLike[];
  }

  if (typeof tray.get_items === "function") {
    const items = tray.get_items();
    if (Array.isArray(items)) {
      return items as TrayItemLike[];
    }
  }

  return [];
}

function roundToInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function trayPrimaryClick(item: TrayItemLike, x = 0, y = 0) {
  try {
    if (item.isMenu) {
      item.secondaryActivate?.(roundToInt(x), roundToInt(y));
      return;
    }
    item.activate?.(roundToInt(x), roundToInt(y));
  } catch {
    // no-op
  }
}

function traySecondaryClick(item: TrayItemLike, x = 0, y = 0) {
  try {
    item.secondaryActivate?.(roundToInt(x), roundToInt(y));
  } catch {
    // no-op
  }
}

function trayTooltip(item: TrayItemLike): { markup?: string; text?: string } {
  const markup = item.tooltipMarkup?.trim();
  if (markup) {
    return { markup };
  }

  const text = item.tooltipText?.trim() || item.title?.trim();
  if (text) {
    return { text };
  }

  return {};
}

function trayIconName(item: TrayItemLike): string {
  const icon = item.iconName?.trim();
  return icon || "image-missing";
}

function barWindows() {
  return app.windows.filter((window) => window.name?.startsWith(BAR_WINDOW_NAME_PREFIX));
}

function setBarsVisible(visible: boolean): string {
  const windows = barWindows();
  for (const window of windows) {
    window.visible = visible;
  }

  return `${visible ? "shown" : "hidden"} ${windows.length} superbar window(s)`;
}

function toggleBars(): string {
  const windows = barWindows();
  const anyVisible = windows.some((window) => window.visible);
  for (const window of windows) {
    window.visible = !anyVisible;
  }

  return `${anyVisible ? "hidden" : "shown"} ${windows.length} superbar window(s)`;
}

function requestHandler(argv: string[], respond: (response: string) => void) {
  const args = argv
    .filter(Boolean)
    .filter((part) => part !== "ags" && !part.endsWith("/ags"));
  const scopedArgs =
    args[0] === "superbar" || args[0] === "bar"
      ? args.slice(1)
      : args;

  const themeResponse = handleThemeRequest(scopedArgs);
  if (themeResponse) {
    respond(themeResponse);
    return;
  }

  const command = scopedArgs[0];

  switch (command) {
    case "show":
      respond(setBarsVisible(true));
      return;
    case "hide":
      respond(setBarsVisible(false));
      return;
    case "toggle":
      respond(toggleBars());
      return;
    case "status": {
      const windows = barWindows();
      const visible = windows.filter((window) => window.visible).length;
      respond(`${visible}/${windows.length} superbar window(s) visible`);
      return;
    }
    default:
      respond('usage: ags request superbar <show|hide|toggle|status|theme ...|glow ...>');
      return;
  }
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatTime(date: Date): string {
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function Workspaces({
  workspaces,
}: {
  workspaces: Accessor<WorkspaceDisplay[]>;
}) {
  return (
    <box class="workspaces" spacing={0}>
      <For each={workspaces}>
        {(workspace) => {
          const workspaceItemClass = [
            "workspace-item",
            workspace.clients.length > 1 ? "has-clients" : "",
            workspace.clients.length === 1 ? "has-single-client" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const keyButtonClass = [
            "key-button",
            "themed-button",
            "glowable",
            workspace.active ? "active" : "",
            workspace.active ? "themed-button-active" : "",
            workspace.empty ? "empty" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <box class={workspaceItemClass} spacing={0}>
              <button class={keyButtonClass} onClicked={() => switchWorkspace(workspace.id)}>
                <label label={workspace.label} />
              </button>

              {workspace.clients.length > 0 ? (
                <box class="workspace-clients themed-chip" halign={Gtk.Align.CENTER} spacing={0} homogeneous>
                  {workspace.clients.map((client) => (
                    <box class="workspace-client-cell" halign={Gtk.Align.CENTER}>
                      <label
                        class={client.active ? "client active themed-chip-icon-active" : "client"}
                        label={client.icon}
                        xalign={0.5}
                        justify={Gtk.Justification.CENTER}
                      />
                    </box>
                  ))}
                </box>
              ) : (
                <box />
              )}
            </box>
          );
        }}
      </For>
    </box>
  );
}

function Programs({ programs }: { programs: Accessor<RunningProgram[]> }) {
  return (
    <box class="programs" spacing={4}>
      <For each={programs}>
        {(program) => (
          <button
            class="program themed-button glowable"
            tooltipText={program.tooltip}
            onClicked={() => focusClient(program.address)}
          >
            <image iconName={program.iconName} pixelSize={18} />
          </button>
        )}
      </For>
    </box>
  );
}

function Systray({ items }: { items: Accessor<TrayItemLike[]> }) {
  return (
    <box class="systray" spacing={4}>
      <For each={items}>
        {(item) => {
          const tooltip = trayTooltip(item);
          return (
            <button
              class="systray-item themed-button glowable"
              tooltipMarkup={tooltip.markup}
              tooltipText={tooltip.text}
              onClicked={() => trayPrimaryClick(item)}
            >
              {item.gicon ? (
                <image gicon={item.gicon} pixelSize={18} />
              ) : (
                <image iconName={trayIconName(item)} pixelSize={18} />
              )}
            </button>
          );
        }}
      </For>
    </box>
  );
}

app.start({
  css: `${scss}\n${getThemeVariablesCss()}`,
  requestHandler,
  main() {
    const { TOP, LEFT, RIGHT } = Astal.WindowAnchor;
    const superbarWindowClass = createThemedWindowClass("superbar");
    const [hypr, setHypr] = createState(EMPTY_HYPR_STATE);
    const [trayItems, setTrayItems] = createState<TrayItemLike[]>([]);
    const [trayEnabled, setTrayEnabled] = createState(false);
    const hyprEvents = createSubprocess<HyprEvent>({ tick: 0, line: "" }, hyprSocketCommand(), (stdout, previous) =>
      stdout.length > 0 ? { tick: previous.tick + 1, line: stdout } : previous,
    );
    const hyprFallbackTick = createPoll(0, HYPR_FALLBACK_POLL_MS, (previous) => previous + 1);
    const hyprStaticTick = createPoll(0, HYPR_STATIC_POLL_MS, (previous) => previous + 1);
    const trayFallbackTick = createPoll(0, TRAY_FALLBACK_POLL_MS, (previous) => previous + 1);
    const now = createPoll(new Date(), 1000, () => new Date());
    let tray: TrayLike | null = null;
    const traySignalIds: number[] = [];
    const trayItemSignalIds = new Map<TrayItemLike, number[]>();
    let refreshInFlight = false;
    let refreshQueued = false;
    let queuedIncludeClients = false;
    let queuedIncludeStatic = false;

    const refreshTrayItems = () => {
      const items = trayItemsFromSource(tray);
      const seen = new Set<TrayItemLike>();

      for (const item of items) {
        seen.add(item);
        if (trayItemSignalIds.has(item)) {
          continue;
        }

        const ids = [
          tryConnectSignal(item, "changed", refreshTrayItems),
          tryConnectSignal(item, "ready", refreshTrayItems),
          tryConnectSignal(item, "notify::gicon", refreshTrayItems),
          tryConnectSignal(item, "notify::icon-name", refreshTrayItems),
          tryConnectSignal(item, "notify::tooltip-markup", refreshTrayItems),
          tryConnectSignal(item, "notify::tooltip-text", refreshTrayItems),
        ].filter((id): id is number => id !== null);

        trayItemSignalIds.set(item, ids);
      }

      for (const [item, ids] of trayItemSignalIds) {
        if (seen.has(item)) {
          continue;
        }

        for (const id of ids) {
          tryDisconnectSignal(item, id);
        }
        trayItemSignalIds.delete(item);
      }

      setTrayItems([...items]);
    };

    const clearTray = () => {
      for (const [item, ids] of trayItemSignalIds) {
        for (const id of ids) {
          tryDisconnectSignal(item, id);
        }
      }
      trayItemSignalIds.clear();

      for (const id of traySignalIds) {
        tryDisconnectSignal(tray, id);
      }
      traySignalIds.length = 0;

      tray = null;
      setTrayEnabled(false);
      setTrayItems([]);
    };

    const setupTray = async () => {
      clearTray();
      const module = await import("gi://AstalTray").catch(() => null);
      if (!module) {
        console.error("[superbar] AstalTray is not available; systray area will stay empty.");
        return;
      }

      const namespace = ((module as { default?: unknown }).default ?? module) as {
        get_default?: () => unknown;
        Tray?: {
          get_default?: () => unknown;
          new?: () => unknown;
        };
      };

      const trayInstance =
        namespace.get_default?.() ||
        namespace.Tray?.get_default?.() ||
        (typeof namespace.Tray?.new === "function" ? namespace.Tray.new() : null);

      if (!trayInstance) {
        console.error("[superbar] AstalTray loaded but no tray instance could be created.");
        return;
      }

      tray = trayInstance as TrayLike;
      setTrayEnabled(true);

      const ids = [
        tryConnectSignal(tray, "item-added", refreshTrayItems),
        tryConnectSignal(tray, "item-removed", refreshTrayItems),
        tryConnectSignal(tray, "notify::items", refreshTrayItems),
      ].filter((id): id is number => id !== null);
      traySignalIds.push(...ids);

      refreshTrayItems();
    };

    void setupTray();

    const refreshHyprState = async (
      options: {
        includeClients?: boolean;
        includeStatic?: boolean;
      } = {},
    ) => {
      const includeClients = options.includeClients ?? true;
      const includeStatic = options.includeStatic ?? false;
      if (refreshInFlight) {
        refreshQueued = true;
        queuedIncludeClients = queuedIncludeClients || includeClients;
        queuedIncludeStatic = queuedIncludeStatic || includeStatic;
        return;
      }

      refreshInFlight = true;
      try {
        const previous = hypr();
        const [dynamic, staticData] = await Promise.all([
          fetchDynamicHyprState(previous, includeClients),
          includeStatic ? fetchStaticHyprState(previous) : Promise.resolve(null),
        ]);

        setHypr({
          ...previous,
          ...dynamic,
          ...(staticData || {}),
        });
      } finally {
        refreshInFlight = false;
        if (refreshQueued) {
          const nextIncludeClients = queuedIncludeClients;
          const nextIncludeStatic = queuedIncludeStatic;
          refreshQueued = false;
          queuedIncludeClients = false;
          queuedIncludeStatic = false;
          void refreshHyprState({
            includeClients: nextIncludeClients,
            includeStatic: nextIncludeStatic,
          });
        }
      }
    };

    createEffect(() => {
      const event = hyprEvents();
      void refreshHyprState({
        includeClients: shouldFetchClientsForEvent(event.line),
        includeStatic: event.tick === 0,
      });
    }, { immediate: true });

    createEffect(() => {
      const tick = hyprFallbackTick();
      if (tick > 0) {
        void refreshHyprState({ includeClients: true });
      }
    });

    createEffect(() => {
      const tick = hyprStaticTick();
      if (tick > 0) {
        void refreshHyprState({ includeClients: false, includeStatic: true });
      }
    });

    createEffect(() => {
      const tick = trayFallbackTick();
      if (tick > 0 && trayEnabled()) {
        refreshTrayItems();
      }
    });

    return app.get_monitors().map((gdkmonitor, index) => {
      const monitorName = gdkmonitor.connector ?? "";
      const mainMonitor = monitorName === MAIN_MONITOR;
      const workspaces = hypr((state) => workspaceDisplayForMonitor(state, monitorName));

      return (
        <window
          visible={false}
          name={`${BAR_WINDOW_NAME_PREFIX}${index}`}
          namespace={BAR_NAMESPACE}
          class={superbarWindowClass}
          gdkmonitor={gdkmonitor}
          layer={Astal.Layer.OVERLAY}
          keymode={Astal.Keymode.NONE}
          exclusivity={Astal.Exclusivity.IGNORE}
          anchor={TOP | LEFT | RIGHT}
          application={app}
        >
          <box class="bar-root" orientation={Gtk.Orientation.HORIZONTAL} spacing={0} hexpand canTarget={false}>
            <box class="bar-slot bar-slot-left" hexpand>
              {mainMonitor ? (
                <box class="bar-left themed-panel glowable" spacing={4} halign={Gtk.Align.START}>
                  <Systray items={trayItems} />
                </box>
              ) : (
                <box />
              )}
            </box>

            <box class="bar-slot bar-slot-center" canTarget={false}>
              <box class="bar-center themed-panel glowable" halign={Gtk.Align.CENTER}>
                <Workspaces workspaces={workspaces} />
              </box>
            </box>

            <box class="bar-slot bar-slot-right" hexpand canTarget={false}>
              <box hexpand />
              {mainMonitor ? (
                <box class="bar-right themed-panel glowable" spacing={8}>
                  <label class="clock themed-text-muted" label={now((date) => formatTime(date))} />
                  <label class="date themed-text-muted" label={now((date) => formatDate(date))} />
                </box>
              ) : (
                <box />
              )}
            </box>
          </box>
        </window>
      );
    });
  },
});

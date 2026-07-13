import type { ChatWidgetHandle, LiveSupportWindowApi } from './sdk-types';

type WidgetControl = Pick<ChatWidgetHandle, 'open' | 'close' | 'toggle'>;
type WidgetAction = keyof WidgetControl;

let activeWidget: WidgetControl | undefined;
const pendingActions: WidgetAction[] = [];

const globalApi: LiveSupportWindowApi = {
  open: () => invoke('open'),
  close: () => invoke('close'),
  toggle: () => invoke('toggle'),
};

export function installGlobalApi(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.LiveSupport = Object.assign(window.LiveSupport ?? {}, globalApi);
}

export function registerWidgetHandle(widget: WidgetControl): () => void {
  installGlobalApi();
  activeWidget = widget;

  while (pendingActions.length > 0) {
    const action = pendingActions.shift();
    if (action !== undefined) {
      widget[action]();
    }
  }

  return () => {
    if (activeWidget === widget) {
      activeWidget = undefined;
    }
  };
}

function invoke(action: WidgetAction): void {
  if (activeWidget === undefined) {
    pendingActions.push(action);
    return;
  }

  activeWidget[action]();
}

installGlobalApi();

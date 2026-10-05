import { useCallback, useEffect, useReducer, useRef } from 'react';
import { type BgToPanel, PANEL_PORT, type PanelToBg } from '../messages';
import { initialPanelState, panelReducer } from './panelState';

export function usePanelPort() {
  const [state, dispatch] = useReducer(panelReducer, initialPanelState);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  const connect = useCallback(() => {
    const port = chrome.runtime.connect({ name: PANEL_PORT });
    port.onMessage.addListener((m: BgToPanel) => dispatch(m));
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      dispatch({ type: 'disconnected' });
    });
    portRef.current = port;
    return port;
  }, []);

  useEffect(() => {
    connect();
    return () => portRef.current?.disconnect();
  }, [connect]);

  const send = useCallback((m: PanelToBg) => (portRef.current ?? connect()).postMessage(m), [connect]);
  return { state, dispatch, send };
}

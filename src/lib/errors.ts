/** An action failed in a way the model should be told about and can recover from. */
export class ToolError extends Error {
  override name = 'ToolError';
}

/** The debugger lost the tab (DevTools, user cancelled the infobar). The task pauses for Retry. */
export class DetachedError extends Error {
  override name = 'DetachedError';
}

/** The task cannot continue (e.g. all agent tabs were closed). */
/** Another extension's frame in the page makes Chrome refuse debugger access to the tab. */
export class ExtensionConflictError extends DetachedError {
  override name = 'ExtensionConflictError';
}

export class TaskEndedError extends Error {
  override name = 'TaskEndedError';
}

export class LlmError extends Error {
  override name = 'LlmError';
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
  /** The gateway said this model speaks a different wire protocol (chat / responses / messages). */
  protocolUnsupported = false;
}

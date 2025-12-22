type LogEntry = {
  timestamp: Date;
  type: 'info' | 'error' | 'request' | 'response';
  message: string;
  details?: string;
};

const MAX_ENTRIES = 50;
let logs: LogEntry[] = [];
let listeners: ((logs: LogEntry[]) => void)[] = [];

export const debugLog = {
  info: (message: string, details?: string) => {
    addLog('info', message, details);
  },
  error: (message: string, details?: string) => {
    addLog('error', message, details);
  },
  request: (message: string, details?: string) => {
    addLog('request', message, details);
  },
  response: (message: string, details?: string) => {
    addLog('response', message, details);
  },
  getLogs: () => [...logs],
  clear: () => {
    logs = [];
    notifyListeners();
  },
  subscribe: (listener: (logs: LogEntry[]) => void) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }
};

function addLog(type: LogEntry['type'], message: string, details?: string) {
  const entry: LogEntry = {
    timestamp: new Date(),
    type,
    message,
    details
  };
  
  logs.unshift(entry);
  if (logs.length > MAX_ENTRIES) {
    logs = logs.slice(0, MAX_ENTRIES);
  }
  
  // Also output to console for remote debugging
  const fullMessage = details ? `${message} - ${details}` : message;
  const timestamp = entry.timestamp.toLocaleTimeString();
  const prefix = `[${timestamp}] [${type.toUpperCase()}]`;
  
  switch (type) {
    case 'error':
      console.error(prefix, fullMessage);
      break;
    case 'info':
      console.log(prefix, fullMessage);
      break;
    case 'request':
      console.log(prefix, '→', fullMessage);
      break;
    case 'response':
      console.log(prefix, '←', fullMessage);
      break;
    default:
      console.log(prefix, fullMessage);
  }
  
  notifyListeners();
}

function notifyListeners() {
  listeners.forEach(l => l([...logs]));
}

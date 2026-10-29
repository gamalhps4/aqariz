const isProduction = process.env.NODE_ENV === "production";

type LogArgs = unknown[];

export const logClientInfo = (...args: LogArgs) => {
  if (!isProduction) {
    console.info(...args);
  }
};

export const logClientWarn = (...args: LogArgs) => {
  if (!isProduction) {
    console.warn(...args);
  }
};

export const logClientError = (...args: LogArgs) => {
  if (!isProduction) {
    console.error(...args);
  }
};

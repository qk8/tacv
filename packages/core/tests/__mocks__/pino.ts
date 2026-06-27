const noop = () => {};
const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger };
export default () => logger;

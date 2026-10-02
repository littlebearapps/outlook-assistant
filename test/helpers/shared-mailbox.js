/**
 * Shared-mailbox support is opt-in (OUTLOOK_SHARED_MAILBOX). Suites that
 * exercise the shared-mailbox paths call this at top level to switch it on
 * for the duration of the file, then restore the original mode.
 * @param {'read'|'readwrite'} [mode]
 */
function enableSharedMailbox(mode = 'readwrite') {
  const config = require('../../config');
  let original;
  beforeAll(() => {
    original = config.SHARED_MAILBOX_MODE;
    config.SHARED_MAILBOX_MODE = mode;
  });
  afterAll(() => {
    config.SHARED_MAILBOX_MODE = original;
  });
}

module.exports = { enableSharedMailbox };
